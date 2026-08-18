/**
 * 待切换会话意图：覆盖式，仅保留最新请求。
 * 覆盖语义保证多次切换只留最后一次，client 轮询不堆积陈旧意图。
 */
export class SwitchIntent {
    pending = undefined;
    seq = 0;
    /** 记录一次切换请求（覆盖旧意图）。 */
    request(sessionId) {
        this.seq += 1;
        this.pending = { sessionId, seq: this.seq };
    }
    /** 读取并清空待切换会话；无意图时返回 undefined。 */
    consume() {
        const value = this.pending?.sessionId;
        this.pending = undefined;
        return value;
    }
}
/**
 * 注册切换意图的 RPC 端点。connection 服务由 dsh-client-connection 在自身 fiber 中
 * provide，插件 apply 时可能尚未激活，故用 ctx.inject 等待其就绪后再注册（参考 dsh-autogate）。
 */
export function registerSwitchRpc(ctx, intent) {
    ctx.inject(['connection'], (connCtx) => {
        const connection = connCtx.get('connection');
        const dispose = connection?.rpc?.handle('/session-tool', async (endpoint) => {
            if (endpoint === 'switch/poll') {
                const sessionId = intent.consume();
                return { ok: true, value: sessionId === undefined ? null : { sessionId } };
            }
            return { ok: false, error: { code: 'internal', message: 'unknown endpoint: ' + endpoint, details: {} } };
        }, { authority: 'loopback' });
        if (dispose !== undefined) {
            connCtx.effect(() => dispose, 'tool-session: switch rpc channel');
        }
    });
}
