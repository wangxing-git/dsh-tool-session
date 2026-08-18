import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput, SESSION_SUMMARY_SCHEMA } from '../value.js';
export function applyListTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'list_sessions',
        description: 'List sessions with id, title, cwd, running/archived flags, and workspace membership. Archived sessions are hidden unless include_archived is true.',
        parameters: {
            include_archived: { type: 'boolean', description: 'Include archived sessions. Defaults to false.' },
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
            const includeArchived = args.include_archived === true;
            const items = [...rows.values()]
                .filter((row) => includeArchived || !row.archived)
                .map((row) => {
                const agent = live.get(row.session_id);
                const title = agent !== undefined && sessionTitle !== undefined ? sessionTitle.get(agent.session)?.title : undefined;
                return { ...row, ...(title !== undefined ? { title } : {}) };
            });
            return { sessions: items };
        },
        presentCall() {
            return { card: 'generic', title: '列出会话' };
        },
    }));
}
