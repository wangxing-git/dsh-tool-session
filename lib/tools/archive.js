import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { requestArchiveApproval } from '../approval.js';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput, sessionExists } from '../value.js';
export function applyArchiveTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'archive_session',
        description: 'Archive a session: hide it from session lists while keeping its durable log (recoverable).',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to archive.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    archived: { type: 'boolean', required: true },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('archive_session', args, exec);
            const currentId = exec.agent?.session.header.id;
            if (currentId !== undefined && String(currentId) === args.session_id) {
                throw new Error('cannot archive the active session: the session this agent is running in');
            }
            // 归档前校验会话可寻址（与 get/switch 对齐），避免归档不存在的会话。
            if (!sessionExists(SessionId(args.session_id), ctx, deps)) {
                throw new Error(`session not found: ${args.session_id}`);
            }
            // 归档默认需要审批（破坏性操作）：批准后才执行。
            await requestArchiveApproval(ctx, args.session_id, exec);
            const registry = deps.workspaceRegistry();
            if (registry === undefined)
                throw new Error('workspace-unavailable: cannot archive');
            await registry.archiveSession(SessionId(args.session_id));
            return { session_id: args.session_id, archived: true };
        },
        presentCall(args) {
            return { card: 'generic', title: `归档会话 ${args.session_id}` };
        },
    }));
}
