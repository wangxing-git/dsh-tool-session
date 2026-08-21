/**
 * 会话自动归档扫描：任何会话创建（session/created）时触发一次后台扫描，
 * 按「每组最多保留 N 个 + 过期优先」规则静默归档历史会话。
 *
 * - 触发：ctx.on('session/created')，覆盖所有新建路径（UI 手动、create_session 工具、
 *   /clear、/new、fork 等）；监听器同步返回、绝不 throw（session/created 同步 throw 会
 *   veto 并回滚创建），扫描由 queueMicrotask 异步调度。
 * - 规则：每组（各工作区 + 未分组）独立；组内未归档会话数（live 也占席位）≤ 上限时不归档；
 *   超限时归档到 ≤ 上限，优先过期（最后活跃时间早于 now - maxAgeDays 天），过期不足
 *   则继续归档最旧的未过期会话。
 * - 「过期」按最后活跃时间判定：updatedAt = max(createdAt, 最后一条人类消息时间)，
 *   与 host-apiproxy 的 sessionListUpdatedAt 同款语义。
 * - 归档为静默行为（跳过审批）：直接 registry.archiveSession，非破坏性（日志与工作区
 *   席位保留，可恢复）。只归档 cold（已持久化但未 attach）会话；live 会话占位但绝不归档，
 *   若超限部分全为 live 则本轮无候选可归档（保留超限，等其转冷后下次扫描再处理）。
 *
 * @module dsh-tool-session/auto-archive
 */
import type { Context } from '@deepseek-ai/cordis';
/** 自动归档配置（SessionToolConfig.autoArchive 的运行时形态）。 */
export interface AutoArchiveConfig {
    /** 总开关，默认关闭。 */
    enabled: boolean;
    /** 「过期」阈值天数：最后活跃时间早于 now - maxAgeDays 天视为过期。 */
    maxAgeDays: number;
    /** 每组（工作区 / 未分组）最多保留的未归档会话数。 */
    maxSessionsPerWorkspace: number;
}
/**
 * 自动归档控制器：session/created 事件驱动、fire-and-forget 异步执行、
 * 运行中合并（dirty 标志）。异常 fail-soft（仅 logger.warn），绝不影响会话创建。
 */
export declare class AutoArchiveController {
    private readonly ctx;
    private readonly getConfig;
    private running;
    private dirty;
    constructor(ctx: Context, getConfig: () => AutoArchiveConfig);
    /** session/created 触发入口：同步返回（绝不同步 throw），异步扫描。 */
    schedule(): void;
    private drain;
    /** 执行一次扫描（now 可注入便于测试）。返回本次归档的会话 id 列表。 */
    scan(now: number): Promise<string[]>;
    /**
     * 最后活跃时间：max(创建时间, 最后一条人类消息时间)。
     *
     * 优先走会话投影缓存（cachedSnapshot 零日志读取，coldSnapshot 只读尾部），与 host
     * session.list 同源；只有缓存缺失时才退回读完整日志。逐会话 readFrom(0) 会让扫描在
     * 大量冷会话下耗时数十秒，归档迟迟不生效，UI 也就迟迟不刷新。
     */
    private updatedAtOf;
}
/** 构造控制器并在 session/created 上接线。 */
export declare function registerAutoArchive(ctx: Context, getConfig: () => AutoArchiveConfig): AutoArchiveController;
