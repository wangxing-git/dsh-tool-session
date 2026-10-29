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
    // 对齐 host-apiproxy 的 Web agent 创建路径：以默认模型的 provider/model/reasoningEffort
    // 作为 agentOptions 的 seed 路由。model selection 的后续切换由 host-apiproxy 的
    // session.selectModel / session.models 端点惰性安装的动态 ref 接管（AgentModel.current()
    // 先读投影、options 只是 fallback）；这里若安装一份固定快照的 model selection，会在
    // system-prompt/assemble 与 agent/request waterfall 中覆盖动态 ref，导致会话中途切换
    // 模型不生效。
    //
    // reasoningEffort 必须在这一层给出，不能在 agent/request 里补：agent-loop 的 step
    // preparation 会把请求配置（含 reasoningEffort）固定下来，随后 agent/request 再返回
    // 不同值会直接抛 "agent/request proposed ... after step preparation fixed ..."，
    // 首轮消息因此失败、会话内容为空（表现为「创建了但列表里看不到的空白会话」）。
    const defaultModel = deps.agentDefaultModel();
    if (defaultModel === undefined)
        throw new Error('agent-default-model-unavailable: cannot resolve a default model for the new session');
    const { provider, model, reasoningEffort } = defaultModel.currentSelection();
    const handle = await ctx.agents.create({
        sessionId,
        agentOptions: { provider, model, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) },
        meta: {
            cwd: params.cwd,
            ...(params.presetId !== undefined ? { agentPreset: params.presetId } : {}),
        },
        setup: (agentCtx) => {
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
