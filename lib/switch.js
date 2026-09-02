/** SSE 事件流路径（/api 下，经共享通道认证）。 */
export const SWITCH_EVENTS_PATH = '/api/tool-session/switch-events';
/**
 * 待切换会话意图：覆盖式，仅保留最新；广播给全部活跃订阅者。
 * 覆盖语义保证多次切换只留最后一次，新连接 snapshot 不会拿到陈旧意图。
 */
export class SwitchIntent {
    pending = undefined;
    listeners = new Set();
    /** 记录一次切换请求（覆盖旧意图），并广播给当前全部订阅者。 */
    request(sessionId) {
        this.pending = sessionId;
        for (const listener of [...this.listeners])
            listener(sessionId);
    }
    /** 最近一次请求的意图（不消费；供新连接建立时重放兜底）。 */
    snapshot() {
        return this.pending;
    }
    /** 订阅实时切换广播；返回退订函数。 */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
/**
 * 注册切换意图的 SSE 端点。connection 服务由 dsh-client-connection 提供，
 * 插件 apply 时可能尚未激活，故用 ctx.inject 等待其就绪后再注册（参考 dsh-autogate）。
 */
export function registerSwitchEvents(ctx, intent) {
    ctx.inject(['connection'], (connCtx) => {
        const connection = connCtx.get('connection');
        const register = connection?.fetch?.register;
        if (register === undefined)
            return; // 极端环境无 fetch 注册器：跳过
        connCtx.effect(async () => {
            const dispose = await register({
                path: SWITCH_EVENTS_PATH,
                methods: ['GET'],
                fetch: (request) => switchEventsResponse(intent, request),
            });
            return () => void dispose();
        }, 'tool-session: switch events route');
    });
}
/** 把一次切换意图序列化为一条 SSE 数据帧。 */
function sseFrame(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}
/**
 * 处理一次 SSE 请求：先发 ready 帧，再重放最近一次 switch-intent（若有），
 * 随后订阅并推送实时 switch-intent；连接断开（abort / cancel）时退订并关闭流。
 */
async function switchEventsResponse(intent, request) {
    if (request.method !== 'GET')
        return new Response('method not allowed', { status: 405 });
    const encoder = new TextEncoder();
    let active = true;
    let unsubscribe;
    const stream = new ReadableStream({
        start(controller) {
            const write = (payload) => {
                if (!active)
                    return;
                try {
                    controller.enqueue(encoder.encode(sseFrame(payload)));
                }
                catch {
                    // 消费端已取消：停止写入，交由 cancel/abort 收尾。
                    active = false;
                }
            };
            // ready 先于重放与订阅投递：request 若发生在重放之前，重放兜底送达；
            // 若发生在订阅之后，广播送达（重复 open 幂等，无副作用）。
            write({ type: 'ready' });
            const pending = intent.snapshot();
            if (pending !== undefined)
                write({ type: 'tool-session/switch-intent', sessionId: pending });
            unsubscribe = intent.subscribe((sessionId) => write({ type: 'tool-session/switch-intent', sessionId }));
            const dispose = () => {
                if (!active)
                    return;
                active = false;
                unsubscribe?.();
                unsubscribe = undefined;
                try {
                    // 请求被 abort（连接断开）：主动关闭流，消费端 read 得以结束。
                    controller.close();
                }
                catch (_error) {
                    // 流已被消费端取消：close 会抛，忽略即可。
                }
            };
            request.signal.addEventListener('abort', dispose, { once: true });
        },
        cancel() {
            if (!active)
                return;
            active = false;
            unsubscribe?.();
            unsubscribe = undefined;
        },
    });
    return new Response(stream, {
        status: 200,
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        },
    });
}
