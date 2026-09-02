import { describe, expect, it } from 'vitest'
import { SwitchIntent } from '../src/switch.js'

describe('SwitchIntent', () => {
  it('无意图时 snapshot 返回 undefined', () => {
    expect(new SwitchIntent().snapshot()).toBeUndefined()
  })

  it('request 后 snapshot 返回该意图', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    expect(intent.snapshot()).toBe('session-a')
  })

  it('覆盖式：多次 request 只保留最新', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    intent.request('session-b')
    expect(intent.snapshot()).toBe('session-b')
  })

  it('request 同步广播给全部订阅者', () => {
    const intent = new SwitchIntent()
    const received: string[] = []
    const unsubscribeA = intent.subscribe((id) => received.push('a:' + id))
    const unsubscribeB = intent.subscribe((id) => received.push('b:' + id))
    intent.request('session-a')
    expect(received).toEqual(['a:session-a', 'b:session-a'])
    unsubscribeA()
    unsubscribeB()
    intent.request('session-b')
    expect(received).toEqual(['a:session-a', 'b:session-a'])
  })

  it('退订后不再收到广播', () => {
    const intent = new SwitchIntent()
    const received: string[] = []
    const unsubscribe = intent.subscribe((id) => received.push(id))
    intent.request('session-a')
    unsubscribe()
    intent.request('session-b')
    expect(received).toEqual(['session-a'])
  })
})
