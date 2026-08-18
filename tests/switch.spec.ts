import { describe, expect, it } from 'vitest'
import { SwitchIntent } from '../src/switch.js'

describe('SwitchIntent', () => {
  it('无意图时 consume 返回 undefined', () => {
    expect(new SwitchIntent().consume()).toBeUndefined()
  })

  it('request 后 consume 返回并清空', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    expect(intent.consume()).toBe('session-a')
    expect(intent.consume()).toBeUndefined()
  })

  it('覆盖式：多次 request 只保留最新', () => {
    const intent = new SwitchIntent()
    intent.request('session-a')
    intent.request('session-b')
    expect(intent.consume()).toBe('session-b')
  })
})
