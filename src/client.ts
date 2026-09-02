/**
 * dsh-tool-session 客户端插件：
 * 1. 把 7 个会话工具的专属折叠行注册进 tool.call.toolview keyed slot，
 *    替换未注册时的 generic 卡片（见 session-tool-row.tsx）；
 * 2. 订阅 /api/tool-session/switch-events 的 SSE 事件流，收到切换意图后调用
 *    ctx.sessions.open(sessionId) 完成 UI 层面的会话切换（连接存活期间零轮询，
 *    断线按指数退避重连；connection generation 变化时立即重订）。
 *
 * 依赖 DSH Web 宿主注入的运行时，故类型刻意宽松（ctx: any），与既有
 * dsh-autogate 的 client.tsx 一致；组件内部保持严格类型（session-tool-row.tsx）。
 *
 * @module dsh-tool-session/client
 */
import { SessionToolRow } from './client/session-tool-row.js'
import { SESSION_TOOL_PRESENTATIONS } from './client/presentations.js'

/** SSE 事件流路径（与 host 端 src/switch.ts 的 SWITCH_EVENTS_PATH 一致）。 */
const SWITCH_EVENTS_PATH = '/api/tool-session/switch-events'
/** 断线重连退避：500ms 起，指数翻倍，上限 10s（与官方 ConnectionController 节奏一致）。 */
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 10_000

/** SSE 帧负载（结构匹配 host 端 SwitchFramePayload；ready 仅作连接就绪，忽略）。 */
type SwitchFramePayload =
  | { type: 'ready' }
  | { type: 'tool-session/switch-intent'; sessionId: string }

/** 客户端插件依赖的服务：sessions（ctx.sessions.open 切换）、connection（连接代际重订）、slots（注册工具视图）。 */
export const inject = ['sessions', 'connection', 'slots']

/** 注册工具视图 + SSE 事件订阅副作用；插件卸载时由 ctx.effect 清理。 */
export function apply(ctx: any): void {
  // 1. 注册 7 个会话工具的专属折叠行（不依赖事件通道，缺省连接时也照常注册）。
  ctx.slots.inject('tool.call.toolview', () =>
    Object.keys(SESSION_TOOL_PRESENTATIONS).map((name) =>
      ctx.slots.register({ name: 'tool.call.toolview', key: name }, SessionToolRow),
    ),
  )

  // 2. 订阅切换意图 SSE（依赖 connection；缺失时静默跳过）。
  const connection = ctx.connection
  if (connection === undefined) return

  const open = (sessionId: string | null | undefined): void => {
    if (typeof sessionId === 'string' && sessionId !== '') ctx.sessions.open(sessionId)
  }

  // 按空行分帧，逐行解析 data: 前缀（SSE 帧可能跨 chunk 到达，buffer 续接）。
  const processFrame = (raw: string): void => {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const payload = JSON.parse(line.slice(6)) as SwitchFramePayload
        if (payload.type === 'tool-session/switch-intent') open(payload.sessionId)
      } catch (_error) {
        // 坏帧：忽略继续，不中断事件流。
      }
    }
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  // 订阅循环：成功建立连接则重置退避；断开后指数退避重连，直到插件卸载。
  let disposed = false
  let retryDelay = RETRY_BASE_MS
  let active: AbortController | undefined

  const loop = async (): Promise<void> => {
    while (!disposed) {
      const controller = new AbortController()
      active = controller
      try {
        const response = await fetch(SWITCH_EVENTS_PATH, { signal: controller.signal })
        if (!response.ok || response.body === null) throw new Error('switch events: HTTP ' + response.status)
        retryDelay = RETRY_BASE_MS
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!disposed) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let separator: number
          while ((separator = buffer.indexOf('\n\n')) !== -1) {
            processFrame(buffer.slice(0, separator))
            buffer = buffer.slice(separator + 2)
          }
        }
      } catch (_error) {
        // 网络抖动 / 服务暂不可用：退避后重连，不打断已有会话。
      } finally {
        if (active === controller) active = undefined
      }
      if (disposed) break
      await sleep(retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }
  }

  // connection generation 变化（官方重连/重置）时中断当前流，立即以最短退避重订。
  const resetOnGeneration = connection.generation?.subscribe?.(() => {
    retryDelay = RETRY_BASE_MS
    active?.abort()
  })

  void loop()
  ctx.effect(() => () => {
    disposed = true
    resetOnGeneration?.()
    active?.abort()
  }, 'tool-session: switch events subscription')
}
