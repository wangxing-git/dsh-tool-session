import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput } from '../value.js';
export function applyCurrentTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'get_current_session',
        description: 'Get information about the current session (the session this agent is running in): its id, cwd, title, and workspace membership.',
        parameters: {
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    cwd: { type: 'string' },
                    title: { type: 'string' },
                    workspace_id: { type: 'string' },
                    workspace_title: { type: 'string' },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('get_current_session', args, exec);
            const agent = exec.agent;
            if (agent === undefined)
                throw new Error('no agent: cannot read the current session');
            const session = agent.session;
            const sessionId = session.header.id;
            const cwd = session.header.cwd;
            const sessionTitle = deps.sessionTitle();
            const title = sessionTitle !== undefined ? sessionTitle.get(session)?.title : undefined;
            const registry = deps.workspaceRegistry();
            let workspaceId;
            let workspaceTitle;
            if (registry !== undefined) {
                for (const ws of registry.list()) {
                    if (ws.sessionIds.some((id) => String(id) === String(sessionId))) {
                        workspaceId = String(ws.id);
                        workspaceTitle = ws.title;
                        break;
                    }
                }
            }
            return {
                session_id: String(sessionId),
                ...(cwd !== undefined ? { cwd } : {}),
                ...(title !== undefined ? { title } : {}),
                ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
                ...(workspaceTitle !== undefined ? { workspace_title: workspaceTitle } : {}),
            };
        },
        presentCall() {
            return { card: 'generic', title: '获取当前会话信息' };
        },
    }));
}
