/** SSE 事件流路径（/api 下，经共享通道认证）。 */
export const SWITCH_EVENTS_PATH = '/api/tool-session/switch-events';
/**
 * 待切换会话意图：覆盖式，仅保留最新；广播给全部活跃订阅者。
 *
 * 投递语义是「一次性事件 + 未送达补投」，**不是**「状态快照」：
 * - request 时实时广播给全部活跃订阅者，任一连接写入成功即推进投递水位；
 * - 新连接建立时只有 revision 高于投递水位的意图（= 从未被任何连接接收，例如
 *   客户端断线期间产生的）才补投；已送达的陈旧意图绝不重放——否则客户端因网络
 *   抖动重连、页面刷新或新开标签时会收到旧意图，被硬拽回上一次 /clear 或
 *   switch_session 的会话。
 */
export class SwitchIntent {
    /** 最近一次请求的意图（覆盖式，仅保留最新）。 */
    pending = undefined;
    /** 已投递水位：revision <= 该值的意图已被某个连接成功写入，不再补投。 */
    delivered = 0;
    /** 自增序号（从 1 开始；0 表示尚无意图）。 */
    sequence = 0;
    listeners = new Set();
    /** 记录一次切换请求（覆盖旧意图），并广播给当前全部订阅者。 */
    request(sessionId) {
        const event = { sessionId, revision: ++this.sequence };
        this.pending = event;
        for (const listener of [...this.listeners])
            listener(event);
    }
    /**
     * 待补投的意图：仅当最近一次意图尚未被任何连接接收时返回，否则 undefined。
     * 新连接建立时据此决定是否补投，已送达的意图不参与重放。
     */
    peekUndelivered() {
        if (this.pending === undefined || this.pending.revision <= this.delivered)
            return undefined;
        return this.pending;
    }
    /** 推进投递水位（幂等，只增不减）；由 SSE 连接在写入成功后调用。 */
    markDelivered(revision) {
        if (revision > this.delivered)
            this.delivered = revision;
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
                requestBody: 'buffered',
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
 * 处理一次 SSE 请求：先发 ready 帧，再补投尚未送达的 switch-intent（若有），
 * 随后订阅并推送实时 switch-intent；连接断开（abort / cancel）时退订并关闭流。
 *
 * 「已送达」以写入成功（enqueue 未抛错）为准：SSE 没有 ack 语义，连接已死而 host
 * 尚未感知时仍会算作送达。代价是极端情况下丢一次切换意图（用户手动点一下即可），
 * 远小于「每次网络抖动重连都把用户拽回旧会话」的代价。
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
                    // 写入成功才推进投递水位；enqueue 抛错（消费端已取消）时不标记，
                    // 于是这次意图仍算「未送达」，能由后续连接补投。
                    if (payload.type === 'tool-session/switch-intent')
                        intent.markDelivered(payload.revision);
                }
                catch {
                    // 消费端已取消：停止写入，交由 cancel/abort 收尾。
                    active = false;
                }
            };
            // ready 先于补投与订阅投递：request 若发生在补投之前，补投送达；若发生在
            // 订阅之后，广播送达。补投只覆盖「尚未被任何连接接收」的意图（写入成功即
            // 由 write 推进投递水位），已送达的陈旧意图不重放（否则重连/刷新会把用户
            // 拽回旧会话）。
            write({ type: 'ready' });
            const pending = intent.peekUndelivered();
            if (pending !== undefined) {
                write({ type: 'tool-session/switch-intent', sessionId: pending.sessionId, revision: pending.revision });
            }
            unsubscribe = intent.subscribe((event) => {
                write({ type: 'tool-session/switch-intent', sessionId: event.sessionId, revision: event.revision });
            });
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
