import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { newSessionId } from './value.js';
/**
 * 以给定参数创建会话并完成归属 / 标题 / 首轮 / 切换。
 * 会话创建经 host 服务（ctx.agents / ctx.sessionTitle / ctx.workspaceRegistry）
 * 完成，不直接碰会话持久化文件；缺 model selection 服务时 fail-closed 拒绝。
 */
export async function createSession(ctx, deps, params) {
    const presets = ctx.get('agentPresets');
    const sessionId = newSessionId();
    const handle = await ctx.agents.create({
        sessionId,
        meta: {
            cwd: params.cwd,
            ...(params.presetId !== undefined ? { agentPreset: params.presetId } : {}),
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
            // 挂载 agent preset（含技能目录与常规工具）。缺服务或未解析时跳过。
            if (presets !== undefined && params.presetId !== undefined) {
                return presets.mount(agentCtx, params.presetId).then(() => undefined);
            }
        },
    });
    if (params.workspace !== undefined) {
        await params.workspace.attachSession(sessionId);
    }
    let title;
    if (params.title !== undefined && params.title.trim() !== '') {
        const sessionTitle = deps.sessionTitle();
        if (sessionTitle === undefined)
            throw new Error('session-title-unavailable: cannot set title');
        title = sessionTitle.rename(handle.agent.session, params.title).title;
    }
    if (params.initialMessage !== undefined && params.initialMessage.trim() !== '') {
        handle.agent.followup(createUserMessage({
            content: [{ type: 'text', text: params.initialMessage }],
            source: { kind: 'user' },
        }));
    }
    if (params.switch === true)
        deps.switchIntent.request(String(sessionId));
    return {
        sessionId,
        ...(params.presetId !== undefined ? { presetId: params.presetId } : {}),
        ...(title !== undefined ? { title } : {}),
    };
}
