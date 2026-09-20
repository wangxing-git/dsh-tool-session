import { describe, expect, it } from 'vitest'
import { SwitchIntent, registerSwitchEvents, SWITCH_EVENTS_PATH, type SwitchFramePayload } from '../src/switch.js'

/** connection.fetch 注册器的最小 mock：捕获路由，暴露 dispose。 */
function makeConnection() {
  let route: { path: string; methods: readonly string[]; fetch: (request: Request) => Promise<Response> } | undefined
  return {
    connection: {
      fetch: {
        register: (r: typeof route & object): (() => Promise<void>) => {
          route = r as typeof route
          return () => { route = undefined }
        },
      },
    },
    route: () => route,
  }
}

/** 构造最小 cordis ctx：inject 立即执行并注入 mock connection（effect 同步执行）。 */
function makeCtx(intent: SwitchIntent) {
  const holder = makeConnection()
  const ctx = {
    inject: (_services: string[], fn: (c: unknown) => void) => fn({
      get: () => holder.connection,
      effect: (fn: () => unknown, _label: string) => { fn() },
    }),
  }
  return { ctx, ...holder }
}

/** 从事件流读取指定数量的帧（SSE 帧可能粘在同一 chunk，跨 chunk 时续接）。 */
async function readFrames(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, count: number): Promise<SwitchFramePayload[]> {
  const frames: SwitchFramePayload[] = []
  let buffer = ''
  while (frames.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator: number
    while ((separator = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ')) continue
        frames.push(JSON.parse(line.slice(6)) as SwitchFramePayload)
      }
    }
  }
  return frames
}

describe('registerSwitchEvents', () => {
  it('以 GET 注册 /api/tool-session/switch-events 精确路由', () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    expect(route()?.path).toBe(SWITCH_EVENTS_PATH)
    expect(route()?.methods).toEqual(['GET'])
  })

  it('GET 请求返回 SSE 响应头', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
  })

  it('非 GET 请求返回 405', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'POST' }))
    expect(response.status).toBe(405)
  })

  it('无意图时只收到 ready 帧', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    const frames = await readFrames(response.body!.getReader(), new TextDecoder(), 1)
    expect(frames).toEqual([{ type: 'ready' }])
  })

  it('连接建立前已有意图：先 ready 再重放 tool-session/switch-intent', async () => {
    const intent = new SwitchIntent()
    intent.request('session-before')
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    const frames = await readFrames(response.body!.getReader(), new TextDecoder(), 2)
    expect(frames).toEqual([
      { type: 'ready' },
      { type: 'tool-session/switch-intent', sessionId: 'session-before', revision: 1 },
    ])
  })

  it('连接存活期间 request 即时推送 tool-session/switch-intent 帧', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    await readFrames(reader, decoder, 1) // ready 帧
    intent.request('session-live')
    const frames = await readFrames(reader, decoder, 1)
    expect(frames).toEqual([{ type: 'tool-session/switch-intent', sessionId: 'session-live', revision: 1 }])
  })

  it('request 广播给多个活跃连接', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const responseA = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    const responseB = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET' }))
    const readerA = responseA.body!.getReader()
    const readerB = responseB.body!.getReader()
    const decoder = new TextDecoder()
    await readFrames(readerA, decoder, 1)
    await readFrames(readerB, decoder, 1)
    intent.request('session-both')
    expect(await readFrames(readerA, decoder, 1)).toEqual([{ type: 'tool-session/switch-intent', sessionId: 'session-both', revision: 1 }])
    expect(await readFrames(readerB, decoder, 1)).toEqual([{ type: 'tool-session/switch-intent', sessionId: 'session-both', revision: 1 }])
  })

  it('连接 abort 后关闭流', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    const abort = new AbortController()
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abort.signal }))
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    await readFrames(reader, decoder, 1) // ready 帧
    abort.abort()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    // 退订后 request 不再触达已关闭连接（无订阅副作用即可）：流的读取已结束。
    intent.request('session-after-abort')
  })

  it('已投递意图在客户端重连（新连接）时不再重放——网络抖动不得把用户拽回旧会话', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)

    // 连接 A：意图产生时客户端在线，实时帧已送达（UI 已切到 session-clear）
    const abortA = new AbortController()
    const responseA = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortA.signal }))
    const readerA = responseA.body!.getReader()
    const decoder = new TextDecoder()
    await readFrames(readerA, decoder, 1) // ready 帧
    intent.request('session-clear')
    expect(await readFrames(readerA, decoder, 1)).toEqual([{ type: 'tool-session/switch-intent', sessionId: 'session-clear', revision: 1 }])

    // 网络抖动：连接 A 断开，客户端进入退避重连
    abortA.abort()
    await expect(readerA.read()).resolves.toMatchObject({ done: true })

    // 连接 B：重连成功——陈旧意图不得重放，否则用户被拽回 session-clear
    const abortB = new AbortController()
    const responseB = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortB.signal }))
    const readerB = responseB.body!.getReader()
    abortB.abort()
    expect(await readFrames(readerB, new TextDecoder(), 5)).toEqual([{ type: 'ready' }])
  })

  it('客户端断开期间产生的意图仍在新连接上补投（兜底不丢意图）', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)

    // 连接 A 建立后断开：其后退避重连窗口内的意图无人接收
    const abortA = new AbortController()
    const responseA = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortA.signal }))
    await readFrames(responseA.body!.getReader(), new TextDecoder(), 1) // ready 帧
    abortA.abort()
    intent.request('session-offline')

    // 新连接建立：补投未送达的意图
    const abortB = new AbortController()
    const responseB = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortB.signal }))
    const readerB = responseB.body!.getReader()
    abortB.abort()
    expect(await readFrames(readerB, new TextDecoder(), 5)).toEqual([
      { type: 'ready' },
      { type: 'tool-session/switch-intent', sessionId: 'session-offline', revision: 1 },
    ])
  })

  it('补投只送最新的未送达意图：被覆盖的旧意图不补投', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)
    intent.request('session-old')
    intent.request('session-new')

    const abort = new AbortController()
    const response = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abort.signal }))
    const reader = response.body!.getReader()
    abort.abort()
    expect(await readFrames(reader, new TextDecoder(), 5)).toEqual([
      { type: 'ready' },
      { type: 'tool-session/switch-intent', sessionId: 'session-new', revision: 2 },
    ])
  })

  it('已送达意图被新意图覆盖后，新意图仍照常补投（水位只挡已送达的）', async () => {
    const intent = new SwitchIntent()
    const { ctx, route } = makeCtx(intent)
    registerSwitchEvents(ctx as any, intent)

    // 连接 A 收到 rev 1（已送达）后断开
    const abortA = new AbortController()
    const responseA = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortA.signal }))
    const readerA = responseA.body!.getReader()
    const decoder = new TextDecoder()
    await readFrames(readerA, decoder, 1) // ready 帧
    intent.request('session-delivered')
    await readFrames(readerA, decoder, 1) // switch-intent 帧
    abortA.abort()

    // 断开期间产生 rev 2：未送达，新连接应补投
    intent.request('session-during-outage')
    const abortB = new AbortController()
    const responseB = await route()!.fetch(new Request('http://dsh.internal' + SWITCH_EVENTS_PATH, { method: 'GET', signal: abortB.signal }))
    const readerB = responseB.body!.getReader()
    abortB.abort()
    expect(await readFrames(readerB, new TextDecoder(), 5)).toEqual([
      { type: 'ready' },
      { type: 'tool-session/switch-intent', sessionId: 'session-during-outage', revision: 2 },
    ])
  })
})
