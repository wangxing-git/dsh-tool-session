import { createSession } from './create-session.js';
/** /clear、/new 的 no-arguments 用法提示（对齐 /compact 语义）。 */
const USAGE = 'Usage: /clear (no arguments)';
/** 解析会话实际运行的 agent preset：倒序找最近一次 agent-preset/selected 事件，回退 header（对齐 dsh-agent-presets 投影语义）。 */
function resolveSessionPreset(session) {
    const events = session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string')
            return event.data.agentPreset;
    }
    return session.header.agentPreset;
}
/**
 * 执行一次「新建会话并切换」：继承当前会话的 cwd 与 agent preset，
 * 创建新会话、归属 path===cwd 的工作区，并请求 UI 切换到新会话。
 */
async function executeNewSession(ctx, deps, invocation) {
    if (invocation.rawInput.trim().length > 0) {
        return { kind: 'error', text: USAGE };
    }
    if (invocation.signal.aborted) {
        return { kind: 'error', text: 'New session cancelled.' };
    }
    const session = invocation.agent.session;
    const cwd = session.header.cwd;
    if (cwd === undefined) {
        return { kind: 'error', text: 'Cannot start a new session: the current session has no working directory.' };
    }
    try {
        // 继承当前会话「实际运行」的 preset（含创建后的 agent-preset/selected 事件），
        // rosterless 部署时为 undefined，新会话保持不挂 preset。
        const presetId = resolveSessionPreset(session);
        const registry = deps.workspaceRegistry();
        const workspace = registry === undefined ? undefined : registry.list().find((ws) => ws.path === cwd);
        const { sessionId } = await createSession(ctx, deps, {
            cwd,
            workspace,
            ...(presetId !== undefined ? { presetId } : {}),
            switch: true,
        });
        return { kind: 'success', text: `Started a new session: ${String(sessionId)}` };
    }
    catch (error) {
        if (invocation.signal.aborted) {
            return { kind: 'error', text: 'New session cancelled.' };
        }
        throw error;
    }
}
/**
 * 注册 /clear 与 /new 命令。commands 服务就绪后注册；插件卸载时先反注册
 * 命令，再等待 in-flight 创建收尾（对齐 dsh-command-compact 的 teardown 顺序）。
 */
export function registerSessionCommands(ctx, deps) {
    ctx.inject(['commands'], (cmdCtx) => {
        const commands = cmdCtx.commands;
        const active = new Set();
        const handler = (invocation) => {
            const operation = executeNewSession(ctx, deps, invocation);
            active.add(operation);
            const retire = () => { active.delete(operation); };
            operation.then(retire, retire);
            return operation;
        };
        cmdCtx.effect(function* () {
            yield async () => { await Promise.allSettled(active); };
            yield commands.register({
                name: 'clear',
                description: 'Start a new session (clears context) and switch to it',
                handler,
            });
            yield commands.register({
                name: 'new',
                description: 'Create a new session and switch to it',
                handler,
            });
        }, 'tool-session: clear/new commands');
    });
}
