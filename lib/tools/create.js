import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionSandboxController } from '../sandbox.js';
import { createSession } from '../create-session.js';
import { renderJsonOutput, resolveCreateTarget } from '../value.js';
export function applyCreateTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'create_session',
        description: 'Create a new session in a workspace directory. Optionally set its title, start a first turn with an initial user message, and switch the UI to it.',
        parameters: {
            cwd: { type: 'string', description: 'Working directory for the new session. Defaults to the calling session cwd.' },
            workspace_id: { type: 'string', description: 'Workspace id to attach the new session to. Defaults to the workspace whose path matches the resolved cwd (usually the current workspace).' },
            title: { type: 'string', description: 'Initial title for the new session (explicit rename).' },
            agent_preset: { type: 'string', description: 'Agent preset the new session agent is composed from.' },
            switch: { type: 'boolean', description: 'When true, switch the UI to the new session after creation. Defaults to false.' },
            initial_message: { type: 'string', description: 'Optional first user message: start a first turn on the new session right after creation.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    cwd: { type: 'string', required: true },
                    agent_preset: { type: 'string' },
                    title: { type: 'string' },
                },
            },
            render: renderJsonOutput,
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('create_session', args, exec);
            const { cwd, workspace } = resolveCreateTarget(args, exec, deps);
            // 在会话存在前 resolve agent preset（undefined → 默认 preset，如 code），
            // setup 里再 mount，对齐 host-apiproxy 的 composeAgent 创建路径。缺
            // agentPresets 服务（rosterless 部署）时跳过，新会话仅有 host 层工具。
            const presets = ctx.get('agentPresets');
            const requestedPreset = args.agent_preset !== undefined && args.agent_preset.trim() !== '' ? args.agent_preset.trim() : undefined;
            const resolvedId = presets === undefined ? undefined : (await presets.resolve(requestedPreset)).id;
            const { sessionId, title } = await createSession(ctx, deps, {
                cwd,
                workspace,
                ...(resolvedId !== undefined ? { presetId: resolvedId } : {}),
                ...(args.title !== undefined && args.title.trim() !== '' ? { title: args.title } : {}),
                ...(args.initial_message !== undefined && args.initial_message.trim() !== '' ? { initialMessage: args.initial_message } : {}),
                switch: args.switch === true,
            });
            return {
                session_id: String(sessionId),
                cwd,
                ...(resolvedId !== undefined ? { agent_preset: resolvedId } : {}),
                ...(title !== undefined ? { title } : {}),
            };
        },
        presentCall(args) {
            return { card: 'generic', title: `创建会话${args.cwd !== undefined ? '（' + args.cwd + '）' : ''}` };
        },
    }));
}
