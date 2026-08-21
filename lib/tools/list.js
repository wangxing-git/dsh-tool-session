import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput, SESSION_SUMMARY_SCHEMA } from '../value.js';
/** 会话关键字模糊搜索：大小写不敏感，命中标题 / 会话 id / 工作目录 / 工作区标题任一字段即匹配。 */
function matchesSessionQuery(row, query) {
    const needle = query.toLowerCase();
    const fields = [row.session_id, row.title, row.cwd, row.workspace_title];
    return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}
/** 行状态投影：归档优先于 live（归档的 live 会话仍归 archived），否则 live → running，冷会话 → idle。 */
function statusOf(row) {
    if (row.archived)
        return 'archived';
    return row.running ? 'running' : 'idle';
}
/**
 * 解析状态过滤集合：status 未提供时默认排除归档（running + idle）；
 * 'all' 展开为全部三态。
 */
function resolveStatusFilter(status) {
    const statuses = new Set();
    if (status === undefined) {
        statuses.add('running');
        statuses.add('idle');
    }
    else {
        for (const value of Array.isArray(status) ? status : [status]) {
            if (value === 'all') {
                statuses.add('running');
                statuses.add('idle');
                statuses.add('archived');
            }
            else {
                statuses.add(value);
            }
        }
    }
    return statuses;
}
export function applyListTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'list_sessions',
        description: 'List sessions with id, title, cwd, running/archived flags, and workspace membership. Archived sessions are hidden by default; pass status to filter by state (running/idle/archived, or all), workspace_id for one workspace, or query to fuzzy-search by keyword.',
        parameters: {
            status: {
                oneOf: [
                    { type: 'string', enum: ['running', 'idle', 'archived', 'all'] },
                    { type: 'array', items: { type: 'string', enum: ['running', 'idle', 'archived', 'all'] } },
                ],
                description: 'Filter by session state: "running" (live), "idle" (cold, not archived), "archived", or "all" (every state). Accepts a single value or a list of values. Omit to return non-archived sessions (running + idle).',
            },
            workspace_id: { type: 'string', description: 'Filter sessions to those belonging to the given workspace id. Omit to list sessions across all workspaces.' },
            query: { type: 'string', description: 'Fuzzy search by keyword: case-insensitive substring match against title, session id, cwd, or workspace title. Omit to return all sessions.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sessions: {
                        type: 'array',
                        required: true,
                        items: SESSION_SUMMARY_SCHEMA,
                    },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('list_sessions', args, exec);
            const registry = deps.workspaceRegistry();
            const sessionTitle = deps.sessionTitle();
            const live = new Map(ctx.agents.list().map((agent) => [String(agent.id), agent]));
            const rows = new Map();
            if (registry !== undefined) {
                for (const workspace of registry.list()) {
                    for (const sid of workspace.sessionIds) {
                        const key = String(sid);
                        rows.set(key, {
                            session_id: key,
                            cwd: live.get(key)?.session.header.cwd ?? workspace.path,
                            running: live.has(key),
                            archived: false,
                            workspace_id: String(workspace.id),
                            ...(workspace.title !== undefined ? { workspace_title: workspace.title } : {}),
                        });
                    }
                }
                for (const sid of registry.archivedSessionIds) {
                    const key = String(sid);
                    const agent = live.get(key);
                    rows.set(key, {
                        session_id: key,
                        ...(agent !== undefined ? { cwd: agent.session.header.cwd } : {}),
                        running: live.has(key),
                        archived: true,
                    });
                }
            }
            // 补充 live 但未归属任何 workspace 的会话（孤儿会话）。
            for (const agent of ctx.agents.list()) {
                const key = String(agent.id);
                if (!rows.has(key)) {
                    rows.set(key, { session_id: key, cwd: agent.session.header.cwd, running: true, archived: false });
                }
            }
            const statuses = resolveStatusFilter(args.status);
            const workspaceFilter = args.workspace_id !== undefined ? String(args.workspace_id) : undefined;
            const rawQuery = args.query !== undefined ? args.query.trim() : '';
            const queryFilter = rawQuery !== '' ? rawQuery : undefined;
            const items = [...rows.values()]
                .filter((row) => statuses.has(statusOf(row)))
                .filter((row) => workspaceFilter === undefined || row.workspace_id === workspaceFilter)
                .map((row) => {
                const agent = live.get(row.session_id);
                const title = agent !== undefined && sessionTitle !== undefined ? sessionTitle.get(agent.session)?.title : undefined;
                return { ...row, ...(title !== undefined ? { title } : {}) };
            })
                .filter((row) => queryFilter === undefined || matchesSessionQuery(row, queryFilter));
            return { sessions: items };
        },
        presentCall() {
            return { card: 'generic', title: '列出会话' };
        },
    }));
}
