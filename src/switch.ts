/**
 * 会话切换意图：host 端内存状态 + 事件推送 SSE 端点。
 *
 * 模型调用 switch_session（或 create_session 带 switch:true）后，host 端记录一个
 * 「待切换会话」意图并同步广播给所有活跃订阅者；client 端插件通过
 * /api/tool-session/switch-events 的 SSE 事件流接收，取到后调用
 * `ctx.uiWorkspace.openSession(sessionId)` 完成 UI 切换。
 *
 * 与旧版 500ms 轮询的差异：连接存活期间零轮询，意图到达即时推送；意图仍为
 * 覆盖式（多次切换只保留最新）。兜底按「投递水位」判定：意图只有从未被任何连接
 * 接收过时才在新连接建立时补投（客户端断线期间产生的意图不丢），已被接收过的
 * 陈旧意图绝不重放——重放会让网络抖动重连、页面刷新、新开标签把用户硬拽回
 * 上一次 /clear 或 switch_session 的会话（2026-09-20 缺陷）。
 *
 * 事件通道使用 connection.fetch 的精确路由（官方为流式响应提供的扩展点，
 * 见 HostConnectionFetch 注释 “streaming or browser-native responses”），
 * 请求经 /api 共享通道的 Host/Origin fence + browserAuth 后命中 handler，
 * 与 rpc.handle 通道走同一认证防线。
 *
 * @module dsh-tool-session/switch
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * SSE 帧负载（按事件语义命名，参考官方 $events 流的 ready/emit 结构）：
 * - ready：流协议帧，连接就绪（兼 flush 缓冲），client 端忽略，无命名空间；
 * - tool-session/switch-intent：插件业务事件（带插件命名空间，与官方
 *   api-session/status 等命名风格一致），连接建立时仅补投「尚未投递」的最近
 *   一次意图，其余走实时推送；sessionId 必为 string，无意图场景由「只发 ready」
 *   表达；revision 为单调递增序号，供投递水位与客户端去重。
 */
export type SwitchFramePayload =
  | { type: 'ready' }
  | { type: 'tool-session/switch-intent'; sessionId: string; revision: number }

/** connection.fetch 的精确路由注册器最小契约（结构匹配 HostConnectionFetch）。 */
interface FetchHost {
  register(route: {
    path: string
    methods: readonly ('GET' | 'HEAD' | 'POST')[]
    /** 请求体呈现模式（DSH 0.1.5 起必填）；本路由只读 GET，取 buffered。 */
    requestBody: 'buffered' | 'streaming'
    fetch: (request: Request) => Promise<Response>
  }): () => Promise<void>
}

/** SSE 事件流路径（/api 下，经共享通道认证）。 */
export const SWITCH_EVENTS_PATH = '/api/tool-session/switch-events'

/** 一次切换意图：目标会话 + 单调递增序号（投递水位与客户端去重的依据）。 */
export interface SwitchIntentEvent {
  /** 目标会话 id。 */
  sessionId: string
  /** 自增序号：每次 request 递增，同一序号不会重复产生。 */
  revision: number
}

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
  private pending: SwitchIntentEvent | undefined = undefined
  /** 已投递水位：revision <= 该值的意图已被某个连接成功写入，不再补投。 */
  private delivered = 0
  /** 自增序号（从 1 开始；0 表示尚无意图）。 */
  private sequence = 0
  private listeners = new Set<(event: SwitchIntentEvent) => void>()

  /** 记录一次切换请求（覆盖旧意图），并广播给当前全部订阅者。 */
  request(sessionId: string): void {
    const event: SwitchIntentEvent = { sessionId, revision: ++this.sequence }
    this.pending = event
    for (const listener of [...this.listeners]) listener(event)
  }

  /**
   * 待补投的意图：仅当最近一次意图尚未被任何连接接收时返回，否则 undefined。
   * 新连接建立时据此决定是否补投，已送达的意图不参与重放。
   */
  peekUndelivered(): SwitchIntentEvent | undefined {
    if (this.pending === undefined || this.pending.revision <= this.delivered) return undefined
    return this.pending
  }

  /** 推进投递水位（幂等，只增不减）；由 SSE 连接在写入成功后调用。 */
  markDelivered(revision: number): void {
    if (revision > this.delivered) this.delivered = revision
  }

  /** 订阅实时切换广播；返回退订函数。 */
  subscribe(listener: (event: SwitchIntentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/**
 * 注册切换意图的 SSE 端点。connection 服务由 dsh-client-connection 提供，
 * 插件 apply 时可能尚未激活，故用 ctx.inject 等待其就绪后再注册（参考 dsh-autogate）。
 */
export function registerSwitchEvents(ctx: Context, intent: SwitchIntent): void {
  ctx.inject(['connection'], (connCtx) => {
    const connection = connCtx.get('connection') as { fetch?: FetchHost } | undefined
    const register = connection?.fetch?.register
    if (register === undefined) return // 极端环境无 fetch 注册器：跳过
    connCtx.effect(async () => {
      const dispose = await register({
        path: SWITCH_EVENTS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => switchEventsResponse(intent, request),
      })
      return () => void dispose()
    }, 'tool-session: switch events route')
  })
}

/** 把一次切换意图序列化为一条 SSE 数据帧。 */
function sseFrame(payload: SwitchFramePayload): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * 处理一次 SSE 请求：先发 ready 帧，再补投尚未送达的 switch-intent（若有），
 * 随后订阅并推送实时 switch-intent；连接断开（abort / cancel）时退订并关闭流。
 *
 * 「已送达」以写入成功（enqueue 未抛错）为准：SSE 没有 ack 语义，连接已死而 host
 * 尚未感知时仍会算作送达。代价是极端情况下丢一次切换意图（用户手动点一下即可），
 * 远小于「每次网络抖动重连都把用户拽回旧会话」的代价。
 */
async function switchEventsResponse(intent: SwitchIntent, request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
  const encoder = new TextEncoder()
  let active = true
  let unsubscribe: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (payload: SwitchFramePayload): void => {
        if (!active) return
        try {
          controller.enqueue(encoder.encode(sseFrame(payload)))
          // 写入成功才推进投递水位；enqueue 抛错（消费端已取消）时不标记，
          // 于是这次意图仍算「未送达」，能由后续连接补投。
          if (payload.type === 'tool-session/switch-intent') intent.markDelivered(payload.revision)
        } catch {
          // 消费端已取消：停止写入，交由 cancel/abort 收尾。
          active = false
        }
      }
      // ready 先于补投与订阅投递：request 若发生在补投之前，补投送达；若发生在
      // 订阅之后，广播送达。补投只覆盖「尚未被任何连接接收」的意图（写入成功即
      // 由 write 推进投递水位），已送达的陈旧意图不重放（否则重连/刷新会把用户
      // 拽回旧会话）。
      write({ type: 'ready' })
      const pending = intent.peekUndelivered()
      if (pending !== undefined) {
        write({ type: 'tool-session/switch-intent', sessionId: pending.sessionId, revision: pending.revision })
      }
      unsubscribe = intent.subscribe((event) => {
        write({ type: 'tool-session/switch-intent', sessionId: event.sessionId, revision: event.revision })
      })
      const dispose = (): void => {
        if (!active) return
        active = false
        unsubscribe?.()
        unsubscribe = undefined
        try {
          // 请求被 abort（连接断开）：主动关闭流，消费端 read 得以结束。
          controller.close()
        } catch (_error) {
          // 流已被消费端取消：close 会抛，忽略即可。
        }
      }
      request.signal.addEventListener('abort', dispose, { once: true })
    },
    cancel() {
      if (!active) return
      active = false
      unsubscribe?.()
      unsubscribe = undefined
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
