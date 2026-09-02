/**
 * 会话切换意图：host 端内存状态 + 事件推送 SSE 端点。
 *
 * 模型调用 switch_session（或 create_session 带 switch:true）后，host 端记录一个
 * 「待切换会话」意图并同步广播给所有活跃订阅者；client 端插件通过
 * /api/tool-session/switch-events 的 SSE 事件流接收，取到后调用
 * `ctx.sessions.open(sessionId)` 完成 UI 切换。
 *
 * 与旧版 500ms 轮询的差异：连接存活期间零轮询，意图到达即时推送；意图仍为
 * 覆盖式（多次切换只保留最新），新连接建立时先收一次 snapshot 快照作为兜底，
 * 语义与旧版「轮询消费最新意图」保持一致（不丢意图）。
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
 *   api-session/status 等命名风格一致），连接建立时重放最近一次意图 + 实时
 *   推送；sessionId 必为 string，无意图场景由「只发 ready」表达。
 */
export type SwitchFramePayload =
  | { type: 'ready' }
  | { type: 'tool-session/switch-intent'; sessionId: string }

/** connection.fetch 的精确路由注册器最小契约（结构匹配 HostConnectionFetch）。 */
interface FetchHost {
  register(route: {
    path: string
    methods: readonly ('GET' | 'HEAD')[]
    fetch: (request: Request) => Promise<Response>
  }): () => Promise<void>
}

/** SSE 事件流路径（/api 下，经共享通道认证）。 */
export const SWITCH_EVENTS_PATH = '/api/tool-session/switch-events'

/**
 * 待切换会话意图：覆盖式，仅保留最新；广播给全部活跃订阅者。
 * 覆盖语义保证多次切换只留最后一次，新连接 snapshot 不会拿到陈旧意图。
 */
export class SwitchIntent {
  private pending: string | undefined = undefined
  private listeners = new Set<(sessionId: string) => void>()

  /** 记录一次切换请求（覆盖旧意图），并广播给当前全部订阅者。 */
  request(sessionId: string): void {
    this.pending = sessionId
    for (const listener of [...this.listeners]) listener(sessionId)
  }

  /** 最近一次请求的意图（不消费；供新连接建立时重放兜底）。 */
  snapshot(): string | undefined {
    return this.pending
  }

  /** 订阅实时切换广播；返回退订函数。 */
  subscribe(listener: (sessionId: string) => void): () => void {
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
 * 处理一次 SSE 请求：先发 ready 帧，再重放最近一次 switch-intent（若有），
 * 随后订阅并推送实时 switch-intent；连接断开（abort / cancel）时退订并关闭流。
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
        } catch {
          // 消费端已取消：停止写入，交由 cancel/abort 收尾。
          active = false
        }
      }
      // ready 先于重放与订阅投递：request 若发生在重放之前，重放兜底送达；
      // 若发生在订阅之后，广播送达（重复 open 幂等，无副作用）。
      write({ type: 'ready' })
      const pending = intent.snapshot()
      if (pending !== undefined) write({ type: 'tool-session/switch-intent', sessionId: pending })
      unsubscribe = intent.subscribe((sessionId) => write({ type: 'tool-session/switch-intent', sessionId }))
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
