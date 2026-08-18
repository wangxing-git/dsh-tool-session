import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { SessionSandboxController } from '../sandbox.js';
import { renderJsonOutput } from '../value.js';
export function applyRenameTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'rename_session',
        description: 'Rename a session by setting its explicit title (pins against automatic title generation).',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to rename.' },
            title: { type: 'string', required: true, description: 'New title; must normalize to a non-empty text.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    seq: { type: 'integer', required: true },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('rename_session', args, exec);
            const sessionId = SessionId(args.session_id);
            const agent = ctx.agents.get(sessionId);
            if (agent === undefined) {
                throw new Error(`cannot rename session ${args.session_id}: not loaded — open or switch to it first`);
            }
            const sessionTitle = deps.sessionTitle();
            if (sessionTitle === undefined)
                throw new Error('session-title-unavailable: cannot rename');
            const snapshot = sessionTitle.rename(agent.session, args.title);
            return { session_id: args.session_id, title: snapshot.title, seq: snapshot.eventSeq };
        },
        presentCall(args) {
            return { card: 'generic', title: `重命名会话 ${args.session_id}` };
        },
    }));
}
