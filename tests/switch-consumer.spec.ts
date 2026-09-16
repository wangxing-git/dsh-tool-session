import { describe, expect, it } from 'vitest'
import { SwitchConsumer } from '../src/client/switch-consumer.js'

/**
 * 可控测试台：注入时钟 / 定时器 / 告警，复刻真实契约——
 * open 只在目标已进入本地列表时成功，否则同步抛错（fail loud）。
 */
function makeHarness(options: { subscribeImmediately?: boolean } = {}) {
  let time = 1000
  let nextTimerId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const opens: string[] = []
  const warns: Array<{ message: string; detail: unknown }> = []
  const listListeners = new Set<() => void>()
  const listed = new Set<string>()

  const consumer = new SwitchConsumer({
    open: (sessionId) => {
      if (!listed.has(sessionId)) throw new Error(`sessions.select: unknown session ${sessionId}`)
      opens.push(sessionId)
      // 真实契约：select() 成功后宿主同步 notifyNow()，同步通知所有列表订阅者
      // （含本消费者的回调）——重入路径必须被守卫，否则无限递归。
      for (const listener of [...listListeners]) listener()
    },
    subscribeList: (listener) => {
      listListeners.add(listener)
      // 接缝假设：快照 store 的订阅可能在注册时同步投递一次，必须在守卫下安全。
      if (options.subscribeImmediately === true) listener()
      return () => { listListeners.delete(listener) }
    },
    now: () => time,
    schedule: (listener, ms) => {
      const id = nextTimerId++
      timers.set(id, { at: time + ms, run: listener })
      return id
    },
    cancel: (timer) => { timers.delete(timer as number) },
    warn: (message, detail) => { warns.push({ message, detail }) },
    windowMs: 1000,
    intervalMs: 100,
  })

  return {
    consumer,
    opens,
    warns,
    /** 把目标会话标记为已进入本地列表（模拟 RPC 事件通道补上 added 帧）。 */
    list: (sessionId: string) => { listed.add(sessionId) },
    /** 广播一次列表变化。 */
    notifyList: () => { for (const listener of [...listListeners]) listener() },
    listenerCount: () => listListeners.size,
    timerCount: () => timers.size,
    /** 推进时钟并执行到期定时器（按到期时刻顺序，模拟真实定时器语义）。 */
    advance: (ms: number) => {
      time += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue
        timers.delete(id)
        timer.run()
      }
    },
  }
}

describe('SwitchConsumer', () => {
  it('目标已在本地列表时立即落地，不挂订阅与定时器', () => {
    const h = makeHarness()
    h.list('session-a')
    h.consumer.consume('session-a')
    expect(h.opens).toEqual(['session-a'])
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)
    expect(h.warns).toHaveLength(0)
  })

  it('目标尚未进列表时经列表变化重试落地，成功后立即退订', () => {
    const h = makeHarness()
    h.consumer.consume('session-b')
    expect(h.opens).toEqual([])
    expect(h.listenerCount()).toBe(1)
    expect(h.timerCount()).toBe(1)

    h.list('session-b')
    h.notifyList()

    expect(h.opens).toEqual(['session-b'])
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)
    expect(h.warns).toHaveLength(0)
  })

  it('列表订阅未触发时由定时兜底重试成功', () => {
    const h = makeHarness()
    h.consumer.consume('session-c')
    h.list('session-c')
    h.advance(100)
    expect(h.opens).toEqual(['session-c'])
    expect(h.timerCount()).toBe(0)
    expect(h.warns).toHaveLength(0)
  })

  it('窗口耗尽仍未进列表时告警一次并彻底停止', () => {
    const h = makeHarness()
    h.consumer.consume('session-d')
    h.advance(2000)

    expect(h.opens).toEqual([])
    expect(h.warns).toHaveLength(1)
    expect(h.warns[0].message).toContain('session-d')
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)

    // 放弃后即使目标补进列表也不再尝试（意图已被丢弃）。
    h.list('session-d')
    h.notifyList()
    h.advance(1000)
    expect(h.opens).toEqual([])
    expect(h.warns).toHaveLength(1)
  })

  it('连续意图覆盖式：只落地最新目标，被覆盖的旧目标不落地', () => {
    const h = makeHarness()
    h.consumer.consume('session-e1')
    h.consumer.consume('session-e2')

    h.list('session-e1')
    h.notifyList()
    expect(h.opens).toEqual([])

    h.list('session-e2')
    h.notifyList()
    expect(h.opens).toEqual(['session-e2'])
    expect(h.warns).toHaveLength(0)
  })

  it('dispose 丢弃待处理意图并清理订阅与定时器', () => {
    const h = makeHarness()
    h.consumer.consume('session-f')
    expect(h.listenerCount()).toBe(1)
    expect(h.timerCount()).toBe(1)

    h.consumer.dispose()
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)

    h.list('session-f')
    h.notifyList()
    h.advance(1000)
    expect(h.opens).toEqual([])
    expect(h.warns).toHaveLength(0)
  })

  it('open 成功后宿主同步通知列表不会无限递归（重入守卫）', () => {
    const h = makeHarness()
    h.consumer.consume('session-h')
    expect(h.listenerCount()).toBe(1)
    h.list('session-h')
    h.notifyList()
    expect(h.opens).toEqual(['session-h'])
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)
    expect(h.warns).toHaveLength(0)
  })

  it('订阅注册时同步回调也不会无限递归（重入守卫）', () => {
    const h = makeHarness({ subscribeImmediately: true })
    h.consumer.consume('session-i')
    h.list('session-i')
    h.notifyList()
    expect(h.opens).toEqual(['session-i'])
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)
    expect(h.warns).toHaveLength(0)
  })

  it('落地后再次消费同一目标可重复落地（open 自身幂等）', () => {
    const h = makeHarness()
    h.list('session-g')
    h.consumer.consume('session-g')
    h.consumer.consume('session-g')
    expect(h.opens).toEqual(['session-g', 'session-g'])
    expect(h.listenerCount()).toBe(0)
    expect(h.timerCount()).toBe(0)
  })
})
