import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput, sessionExists } from '../value.js';
export function applySwitchTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'switch_session',
        description: 'Switch the UI to a target session. Idempotent when already the current session.',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to switch the UI to.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    switched: { type: 'boolean', required: true },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('switch_session', args, exec);
            const currentId = exec.agent?.session.header.id;
            if (currentId !== undefined && String(currentId) === args.session_id) {
                return { session_id: args.session_id, switched: true };
            }
            const sessionId = SessionId(args.session_id);
            if (!sessionExists(sessionId, ctx, deps)) {
                throw new Error(`session not found: ${args.session_id}`);
            }
            deps.switchIntent.request(args.session_id);
            return { session_id: args.session_id, switched: true };
        },
        presentCall(args) {
            return { card: 'generic', title: `切换会话 ${args.session_id}` };
        },
    }));
}
