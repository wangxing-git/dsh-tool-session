import { describe, expect, it } from 'vitest'
import { SwitchFrameGate } from '../src/client/switch-frame-gate.js'

describe('SwitchFrameGate', () => {
  it('首次见到的序号放行', () => {
    const gate = new SwitchFrameGate()
    expect(gate.accept(1)).toBe(true)
  })

  it('重复序号丢弃（重连瞬间同一意图经多条连接到达）', () => {
    const gate = new SwitchFrameGate()
    expect(gate.accept(7)).toBe(true)
    expect(gate.accept(7)).toBe(false)
    expect(gate.accept(7)).toBe(false)
  })

  it('乱序到达的陈旧序号丢弃，更大序号照常放行', () => {
    const gate = new SwitchFrameGate()
    expect(gate.accept(5)).toBe(true)
    expect(gate.accept(4)).toBe(false)
    expect(gate.accept(5)).toBe(false)
    expect(gate.accept(6)).toBe(true)
  })

  it('序号缺失（旧版 host 帧）一律放行，保持向后兼容', () => {
    const gate = new SwitchFrameGate()
    expect(gate.accept(undefined)).toBe(true)
    expect(gate.accept(undefined)).toBe(true)
  })

  it('非法序号（坏帧）丢弃且不污染水位', () => {
    const gate = new SwitchFrameGate()
    expect(gate.accept(Number.NaN)).toBe(false)
    expect(gate.accept(0)).toBe(false)
    expect(gate.accept(-3)).toBe(false)
    expect(gate.accept(1.5)).toBe(false)
    expect(gate.accept(Number.POSITIVE_INFINITY)).toBe(false)
    expect(gate.accept(1)).toBe(true)
  })
})
