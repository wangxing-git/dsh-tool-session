import { defineTool } from '@deepseek-ai/dsh-tools';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionSandboxController } from '../sandbox.js';
import { newSessionId, renderJsonOutput, resolveCreateTarget } from '../value.js';
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
            const sessionId = newSessionId();
            const handle = await ctx.agents.create({
                sessionId,
                meta: {
                    cwd,
                    ...(args.agent_preset !== undefined && args.agent_preset !== '' ? { agentPreset: args.agent_preset } : {}),
                },
                setup: (agentCtx) => {
                    // 安装 model selection：注入 provider/model prompt 变量并路由请求（对齐 host-apiproxy 的 Web agent 创建路径）。
                    const defaultModel = deps.agentDefaultModel();
                    if (defaultModel === undefined)
                        throw new Error('agent-default-model-unavailable: cannot install model selection for the new session');
                    installModelSelection(agentCtx, {
                        current: defaultModel.currentSelection(),
                        assembled: undefined,
                    });
                },
            });
            if (workspace !== undefined) {
                await workspace.attachSession(sessionId);
            }
            let title;
            if (args.title !== undefined && args.title.trim() !== '') {
                const sessionTitle = deps.sessionTitle();
                if (sessionTitle === undefined)
                    throw new Error('session-title-unavailable: cannot set title');
                title = sessionTitle.rename(handle.agent.session, args.title).title;
            }
            if (args.initial_message !== undefined && args.initial_message.trim() !== '') {
                handle.agent.followup(createUserMessage({
                    content: [{ type: 'text', text: args.initial_message }],
                    source: { kind: 'user' },
                }));
            }
            if (args.switch === true)
                deps.switchIntent.request(String(sessionId));
            return {
                session_id: String(sessionId),
                cwd,
                ...(args.agent_preset !== undefined && args.agent_preset !== '' ? { agent_preset: args.agent_preset } : {}),
                ...(title !== undefined ? { title } : {}),
            };
        },
        presentCall(args) {
            return { card: 'generic', title: `创建会话${args.cwd !== undefined ? '（' + args.cwd + '）' : ''}` };
        },
    }));
}
