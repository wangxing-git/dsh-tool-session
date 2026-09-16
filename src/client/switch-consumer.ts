/**
 * 切换意图消费者：把 host 广播的「待切换会话」落成一次 UI 会话切换。
 *
 * 意图经 SSE（/api/tool-session/switch-events）到达 client 时，目标会话常常
 * 尚未进入客户端本地会话列表——会话列表走另一条 RPC 事件通道，命令路径
 * （/clear、/new）下本插件的 SSE 帧几乎总是先到。客户端 sessions.open() 的
 * 契约为「未知 id 直接抛错」（fail loud），故首次尝试失败属预期路径而非异常：
 * 在短窗口内重试（列表变化即时触发 + 定时兜底），目标会话出现后立即成功；
 * 只有整段窗口内始终未出现才告警，绝不静默吞掉（对照 code-specs step-08）。
 *
 * 依赖全部注入，不触碰 DSH Web 宿主运行时，故可脱离浏览器单测。
 *
 * @module dsh-tool-session/client/switch-consumer
 */

/** 定时器句柄（宿主与单测注入的定时器实现各自决定其形状）。 */
export type SwitchTimer = unknown

/** 默认重试窗口：命令路径下新会话进入本地列表通常在数十毫秒内，4s 留足余量。 */
const DEFAULT_WINDOW_MS = 4000

/** 默认定时兜底间隔：列表订阅未触发时的保底重试节奏。 */
const DEFAULT_INTERVAL_MS = 120

/** SwitchConsumer 的注入依赖。 */
export interface SwitchConsumerDeps {
  /** 选择目标会话为当前会话；目标未知时同步抛错。 */
  open: (sessionId: string) => void
  /** 订阅客户端会话列表变化；返回退订函数。 */
  subscribeList: (listener: () => void) => () => void
  /** 当前时间（毫秒时间戳）。默认 Date.now。 */
  now?: () => number
  /** 注册一次性定时器。默认 setTimeout。 */
  schedule?: (listener: () => void, ms: number) => SwitchTimer
  /** 取消定时器。默认 clearTimeout。 */
  cancel?: (timer: SwitchTimer) => void
  /** 超时告警（禁止静默吞掉失败）。默认 console.warn。 */
  warn?: (message: string, detail: unknown) => void
  /** 重试窗口总时长（毫秒）。 */
  windowMs?: number
  /** 定时兜底重试间隔（毫秒）。 */
  intervalMs?: number
}

/**
 * 覆盖式消费 host 的切换意图：只保留最新目标（与 host 端 SwitchIntent 语义一致，
 * 避免连续 /clear 时回跳到中间会话），目标未进入列表时在窗口内重试。
 */
export class SwitchConsumer {
  private readonly open: (sessionId: string) => void
  private readonly subscribeList: (listener: () => void) => () => void
  private readonly now: () => number
  private readonly schedule: (listener: () => void, ms: number) => SwitchTimer
  private readonly cancel: (timer: SwitchTimer) => void
  private readonly warn: (message: string, detail: unknown) => void
  private readonly windowMs: number
  private readonly intervalMs: number

  /** 最新待落地的目标；undefined 表示当前没有待处理意图。 */
  private pending: string | undefined = undefined

  /** 当前 pending 的重试截止时刻（毫秒时间戳）。 */
  private deadline = 0

  /** 定时兜底句柄；undefined 表示未挂起。 */
  private timer: SwitchTimer | undefined = undefined

  /** 会话列表订阅退订函数；undefined 表示未订阅。 */
  private unsubscribe: (() => void) | undefined = undefined

  /**
   * 重入守卫：open() 成功会同步 flush 列表通知、订阅注册也可能同步回调，
   * 两条路径都会在本次尝试尚未收尾时重入 attempt()，故直接忽略重入调用。
   */
  private attempting = false

  /**
   * @param deps - 打开方式、列表订阅与可注入的时间源 / 定时器 / 告警。
   */
  constructor(deps: SwitchConsumerDeps) {
    this.open = deps.open
    this.subscribeList = deps.subscribeList
    this.now = deps.now ?? ((): number => Date.now())
    this.schedule = deps.schedule ?? ((listener, ms) => setTimeout(listener, ms))
    this.cancel = deps.cancel ?? ((timer) => { clearTimeout(timer as ReturnType<typeof setTimeout>) })
    this.warn = deps.warn ?? ((message, detail) => { console.warn(message, detail) })
    this.windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  /**
   * 消费一次切换意图，并立即尝试落地。
   * 覆盖式：新的目标取代尚未落地的旧目标（与 host 端「只保留最新意图」一致）。
   * @param sessionId - 目标会话 id（调用方保证非空）。
   */
  consume(sessionId: string): void {
    this.pending = sessionId
    this.deadline = this.now() + this.windowMs
    this.attempt()
  }

  /** 释放：丢弃待处理意图，清定时器并退订列表（插件卸载时调用）。 */
  dispose(): void {
    this.pending = undefined
    this.clearTimer()
    this.clearSubscription()
  }

  /**
   * 尝试落地当前意图。成功即收尾；失败则挂上列表订阅与定时兜底继续等，
   * 直到成功、窗口耗尽（告警）或释放。open 抛错是预期路径，不向外传播——
   * 否则会被 SSE 帧处理的 catch 静默吞掉，正是本类要消除的失效形态。
   */
  private attempt(): void {
    if (this.attempting) return
    this.attempting = true
    try {
      this.settle()
    } finally {
      this.attempting = false
    }
  }

  /** attempt() 的实际内容：与重入守卫分离，保证守卫的 finally 一定收尾。 */
  private settle(): void {
    this.clearTimer()
    const target = this.pending
    if (target === undefined) return
    // 先摘掉意图再打开：open() 成功时宿主会同步 flush 会话列表通知
    // （SessionManager.select → notifier.notifyNow），从而同步重入本类的列表订阅
    // 回调；pending 已清空让重入立刻返回，否则 open → 通知 → attempt 会无限递归。
    this.pending = undefined
    try {
      this.open(target)
    } catch (error) {
      if (this.now() >= this.deadline) {
        // 窗口内目标始终未进入本地列表：告警而非静默（否则表现为「点了没反应」）。
        this.clearSubscription()
        this.warn(`tool-session: switch intent dropped, session never listed: ${target}`, error)
        return
      }
      // 期间若无新意图到达（覆盖式语义），把当前目标放回继续等。
      if (this.pending === undefined) this.pending = target
      this.watch()
      return
    }
    this.clearSubscription()
  }

  /** 挂上列表订阅（即时触发）与定时兜底（保底节奏）；重复调用幂等。 */
  private watch(): void {
    this.unsubscribe ??= this.subscribeList(() => { this.attempt() })
    this.timer ??= this.schedule(() => {
      this.timer = undefined
      this.attempt()
    }, this.intervalMs)
  }

  /** 清掉挂起的定时兜底。 */
  private clearTimer(): void {
    if (this.timer === undefined) return
    this.cancel(this.timer)
    this.timer = undefined
  }

  /** 退订会话列表。 */
  private clearSubscription(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}