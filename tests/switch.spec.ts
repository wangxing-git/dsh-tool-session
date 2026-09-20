import { describe, expect, it } from 'vitest'
import { SwitchIntent } from '../src/switch.js'

describe('SwitchIntent', () => {
  it('无意图时 peekUndelivered 返回 undefined', () => {
    expect(new SwitchIntent().peekUndelivered()).toBeUndefined()
  })

  it('request 后意图处于待补投状态（携带自增序号）', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-a', revision: 1 })
  })

  it('覆盖式：多次 request 只保留最新', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    intent.request('session-b')
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-b', revision: 2 })
  })

  it('request 同步广播给全部订阅者（携带序号）', () => {
    const intent = new SwitchIntent()
    const received: string[] = []
    const unsubscribeA = intent.subscribe((event) => received.push('a:' + event.sessionId + '@' + event.revision))
    const unsubscribeB = intent.subscribe((event) => received.push('b:' + event.sessionId + '@' + event.revision))
    intent.request('session-a')
    expect(received).toEqual(['a:session-a@1', 'b:session-a@1'])
    unsubscribeA()
    unsubscribeB()
    intent.request('session-b')
    expect(received).toEqual(['a:session-a@1', 'b:session-a@1'])
  })

  it('退订后不再收到广播', () => {
    const intent = new SwitchIntent()
    const received: string[] = []
    const unsubscribe = intent.subscribe((event) => received.push(event.sessionId))
    intent.request('session-a')
    unsubscribe()
    intent.request('session-b')
    expect(received).toEqual(['session-a'])
  })

  it('markDelivered 后不再补投：已送达的陈旧意图不重放', () => {
    const intent = new SwitchIntent()
    intent.request('session-clear')
    intent.markDelivered(1)
    expect(intent.peekUndelivered()).toBeUndefined()
  })

  it('已送达的旧意图不影响其后新意图的补投', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    intent.markDelivered(1)
    intent.request('session-b')
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-b', revision: 2 })
  })

  it('覆盖式 + 未送达：只补投最新的未送达意图', () => {
    const intent = new SwitchIntent()
    intent.request('session-old')
    intent.request('session-new')
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-new', revision: 2 })
  })

  it('未送达的意图在多次 peek 时保持可见（peek 不消费）', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-a', revision: 1 })
    expect(intent.peekUndelivered()).toEqual({ sessionId: 'session-a', revision: 1 })
  })
})
