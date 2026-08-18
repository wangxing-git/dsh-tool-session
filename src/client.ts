/**
 * dsh-tool-session 客户端插件：
 * 1. 把 7 个会话工具的专属折叠行注册进 tool.call.toolview keyed slot，
 *    替换未注册时的 generic 卡片（见 session-tool-row.tsx）；
 * 2. 轮询 /session-tool 通道的 switch/poll 端点，取到切换意图后调用
 *    ctx.sessions.open(sessionId) 完成 UI 层面的会话切换。
 *
 * 依赖 DSH Web 宿主注入的运行时，故类型刻意宽松（ctx: any），与既有
 * dsh-autogate 的 client.tsx 一致；组件内部保持严格类型（session-tool-row.tsx）。
 *
 * @module dsh-tool-session/client
 */
import { SessionToolRow } from './client/session-tool-row.js'
import { SESSION_TOOL_PRESENTATIONS } from './client/presentations.js'

/** 轮询间隔（毫秒）。 */
const POLL_INTERVAL_MS = 500

/** RPC 调用返回的最小契约（结构匹配 connection 的 RpcResult）。 */
interface SwitchPollResult {
  ok: boolean
  value?: { sessionId?: string } | null
}

/** 客户端插件依赖的服务：sessions（ctx.sessions.open 切换）、connection（ctx.connection.rpc 轮询）、slots（注册工具视图）。 */
export const inject = ['sessions', 'connection', 'slots']

/** 注册工具视图 + 轮询副作用；插件卸载时由 ctx.effect 清理。 */
export function apply(ctx: any): void {
  // 1. 注册 7 个会话工具的专属折叠行（不依赖 RPC，缺省通道时也照常注册）。
  ctx.slots.inject('tool.call.toolview', () =>
    Object.keys(SESSION_TOOL_PRESENTATIONS).map((name) =>
      ctx.slots.register({ name: 'tool.call.toolview', key: name }, SessionToolRow),
    ),
  )

  // 2. 轮询切换意图（依赖 RPC，缺失时静默跳过）。
  const rpc = ctx.connection?.rpc
  if (rpc?.call === undefined) return // 无 RPC 通道（极端环境）时静默跳过

  // 上一轮 poll 结束后才调度下一轮，避免 RPC 往返慢于轮询间隔时并发请求堆积。
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const poll = async (): Promise<void> => {
    try {
      const result: SwitchPollResult = await rpc.call('/session-tool', 'switch/poll', {})
      const sessionId = result?.ok === true ? result.value?.sessionId : undefined
      if (typeof sessionId === 'string' && sessionId !== '') {
        ctx.sessions.open(sessionId)
      }
    } catch (_error) {
      // 网络抖动 / 服务暂不可用：跳过本轮，下一轮重试，不打断已有会话。
    } finally {
      if (!disposed) timer = setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
    }
  }

  timer = setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
  ctx.effect(() => () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
  }, 'tool-session: switch polling')
}
