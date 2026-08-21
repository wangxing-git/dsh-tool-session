import { SessionId } from '@deepseek-ai/dsh-session';
/** 未分组会话的分组键（不可能与真实工作区 id 冲突的哨兵）。 */
const UNGROUPED = '__ungrouped__';
/** 从投影快照里读 sessionListMetadata.lastPromptAt：number 为值，null 为无人类消息，undefined 为缺失。 */
function lastPromptAtOf(snapshot) {
    const cell = snapshot?.values?.sessionListMetadata;
    if (cell === null || typeof cell !== 'object')
        return undefined;
    const value = cell.lastPromptAt;
    return typeof value === 'number' ? value : value === null ? null : undefined;
}
/** 折叠事件日志，返回最后一条人类消息的时间（epoch ms）；无则 0。 */
function lastPromptAt(events) {
    let latest = 0;
    for (const event of events) {
        if (event.type !== 'user/message')
            continue;
        const data = event.data;
        if (data.source?.kind !== 'user')
            continue;
        if (event.time > latest)
            latest = event.time;
    }
    return latest;
}
/**
 * 自动归档控制器：session/created 事件驱动、fire-and-forget 异步执行、
 * 运行中合并（dirty 标志）。异常 fail-soft（仅 logger.warn），绝不影响会话创建。
 */
export class AutoArchiveController {
    ctx;
    getConfig;
    running = false;
    dirty = false;
    constructor(ctx, getConfig) {
        this.ctx = ctx;
        this.getConfig = getConfig;
    }
    /** session/created 触发入口：同步返回（绝不同步 throw），异步扫描。 */
    schedule() {
        if (!this.getConfig().enabled)
            return;
        this.ctx.logger.info('tool-session: auto-archive scan scheduled (session/created)');
        this.dirty = true;
        if (this.running)
            return;
        this.running = true;
        queueMicrotask(() => { void this.drain(); });
    }
    async drain() {
        try {
            while (this.dirty) {
                this.dirty = false;
                await this.scan(Date.now());
            }
        }
        catch (error) {
            this.ctx.logger.warn('tool-session: auto-archive scan failed: ' + String(error));
        }
        finally {
            this.running = false;
        }
    }
    /** 执行一次扫描（now 可注入便于测试）。返回本次归档的会话 id 列表。 */
    async scan(now) {
        const config = this.getConfig();
        if (!config.enabled)
            return [];
        const registry = this.ctx.get('workspaceRegistry');
        const persistence = this.ctx.get('sessionPersistence');
        if (registry === undefined || persistence === undefined)
            return [];
        const cutoff = now - config.maxAgeDays * 86_400_000;
        const archived = new Set(registry.archivedSessionIds.map((id) => String(id)));
        const liveIds = new Set(this.ctx.agents.list().map((agent) => String(agent.id)));
        const headers = new Map((await persistence.list()).map((header) => [String(header.id), header]));
        const groups = new Map();
        const owned = new Set();
        for (const workspace of registry.list()) {
            let activeCount = 0;
            const candidates = [];
            for (const sid of workspace.sessionIds) {
                const id = String(sid);
                owned.add(id);
                if (archived.has(id))
                    continue;
                activeCount += 1; // 未归档（live + cold）都占保留席位
                if (liveIds.has(id))
                    continue; // live 会话不可归档
                const header = headers.get(id);
                if (header === undefined)
                    continue; // 无持久化记录，不可归档
                candidates.push({ id, updatedAt: await this.updatedAtOf(header, persistence) });
            }
            groups.set(String(workspace.id), { activeCount, candidates });
        }
        // 未分组：live 孤儿（占位、不可归档）+ cold 孤儿（可归档）。
        let ungroupedActive = 0;
        const ungroupedCandidates = [];
        for (const agent of this.ctx.agents.list()) {
            const id = String(agent.id);
            if (owned.has(id) || archived.has(id))
                continue;
            ungroupedActive += 1;
        }
        for (const [id, header] of headers) {
            if (owned.has(id) || archived.has(id) || liveIds.has(id))
                continue;
            ungroupedActive += 1;
            ungroupedCandidates.push({ id, updatedAt: await this.updatedAtOf(header, persistence) });
        }
        groups.set(UNGROUPED, { activeCount: ungroupedActive, candidates: ungroupedCandidates });
        const archivedNow = [];
        for (const group of groups.values()) {
            if (group.activeCount <= config.maxSessionsPerWorkspace)
                continue;
            const excess = group.activeCount - config.maxSessionsPerWorkspace;
            // 只能归档 cold 候选；live 占位不可归档，归档到候选耗尽为止。
            const toArchive = Math.min(excess, group.candidates.length);
            if (toArchive <= 0)
                continue;
            // 过期优先，其次最旧优先。
            group.candidates.sort((a, b) => {
                const aExpired = a.updatedAt < cutoff ? 1 : 0;
                const bExpired = b.updatedAt < cutoff ? 1 : 0;
                return bExpired - aExpired || a.updatedAt - b.updatedAt;
            });
            for (let i = 0; i < toArchive; i++) {
                const id = group.candidates[i].id;
                try {
                    await registry.archiveSession(SessionId(id));
                    archivedNow.push(id);
                }
                catch (error) {
                    this.ctx.logger.warn("tool-session: auto-archive skipped session '" + id + "': " + String(error));
                }
            }
        }
        if (archivedNow.length > 0) {
            this.ctx.logger.info('tool-session: auto-archive archived ' + archivedNow.length + ' session(s): ' + archivedNow.join(', '));
        }
        else {
            this.ctx.logger.info('tool-session: auto-archive scan done, nothing over the per-workspace limit to archive');
        }
        return archivedNow;
    }
    /**
     * 最后活跃时间：max(创建时间, 最后一条人类消息时间)。
     *
     * 优先走会话投影缓存（cachedSnapshot 零日志读取，coldSnapshot 只读尾部），与 host
     * session.list 同源；只有缓存缺失时才退回读完整日志。逐会话 readFrom(0) 会让扫描在
     * 大量冷会话下耗时数十秒，归档迟迟不生效，UI 也就迟迟不刷新。
     */
    async updatedAtOf(header, persistence) {
        const cache = this.ctx.get('sessionProjectionCache');
        if (cache !== undefined) {
            try {
                const cached = lastPromptAtOf(cache.cachedSnapshot(header));
                if (cached !== undefined)
                    return Math.max(header.createdAt, cached ?? 0);
                const cold = lastPromptAtOf(await cache.coldSnapshot(header.id));
                if (cold !== undefined)
                    return Math.max(header.createdAt, cold ?? 0);
            }
            catch (error) {
                this.ctx.logger.warn("tool-session: auto-archive projection for '" + String(header.id) + "' failed: " + String(error));
            }
        }
        // 降级：读完整日志（慢，但保证正确）。读取失败退回 createdAt。
        try {
            const { events } = await persistence.readFrom(header.id, 0);
            return Math.max(header.createdAt, lastPromptAt(events));
        }
        catch (error) {
            this.ctx.logger.warn("tool-session: auto-archive failed to read activity for '" + String(header.id) + "': " + String(error));
            return header.createdAt;
        }
    }
}
/** 构造控制器并在 session/created 上接线。 */
export function registerAutoArchive(ctx, getConfig) {
    const controller = new AutoArchiveController(ctx, getConfig);
    ctx.on('session/created', () => { controller.schedule(); });
    return controller;
}
