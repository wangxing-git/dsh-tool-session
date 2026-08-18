/**
 * 会话切换意图：host 端内存状态 + 供 client 端轮询的 RPC 端点。
 *
 * 模型调用 switch_session（或 create_session 带 switch:true）后，host 端仅记录一个
 * 「待切换会话」意图；client 端插件通过 /session-tool 通道的 switch/poll 端点轮询，
 * 取到后调用 `ctx.sessions.open(sessionId)` 完成 UI 切换。该模式与 dsh-autogate 的
 * trail RPC 轮询一致，不依赖核心包的 host/remote-event 封闭 allowlist。
 *
 * @module dsh-tool-session/switch
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * 待切换会话意图：覆盖式，仅保留最新请求。
 * 覆盖语义保证多次切换只留最后一次，client 轮询不堆积陈旧意图。
 */
export declare class SwitchIntent {
    private pending;
    private seq;
    /** 记录一次切换请求（覆盖旧意图）。 */
    request(sessionId: string): void;
    /** 读取并清空待切换会话；无意图时返回 undefined。 */
    consume(): string | undefined;
}
/**
 * 注册切换意图的 RPC 端点。connection 服务由 dsh-client-connection 在自身 fiber 中
 * provide，插件 apply 时可能尚未激活，故用 ctx.inject 等待其就绪后再注册（参考 dsh-autogate）。
 */
export declare function registerSwitchRpc(ctx: Context, intent: SwitchIntent): void;
