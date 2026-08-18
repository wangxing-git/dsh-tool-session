import { describe, expect, it } from 'vitest'
import { SessionSandboxController } from '../src/sandbox.js'

/** 构造最小 mock ctx：默认无沙箱、无任何可选服务。 */
function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    fs: { sandboxMode: undefined },
    get: (_name: string) => undefined,
    ...overrides,
  }
}

/** 构造沙箱挂载 + sandboxPolicy 可用的 mock ctx。 */
function makeSandboxedCtx(approver?: unknown): any {
  return makeCtx({
    fs: { sandboxMode: 'workspace-write' },
    get: (name: string) => {
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/ws' }) }
      if (name === 'approval') return approver
      return undefined
    },
  })
}

describe('SessionSandboxController 构造', () => {
  it('无沙箱时 escalationModes 为空', () => {
    expect(new SessionSandboxController(makeCtx()).escalationModes).toEqual([])
  })

  it('沙箱挂载时 escalationModes 非空', () => {
    expect(new SessionSandboxController(makeSandboxedCtx()).escalationModes.length).toBeGreaterThan(0)
  })

  it('沙箱挂载但 sandboxPolicy 缺失时抛错', () => {
    expect(() => new SessionSandboxController(makeCtx({ fs: { sandboxMode: 'workspace-write' } }))).toThrow()
  })
})

describe('SessionSandboxController.schemaFields', () => {
  it('返回两个提权字段且 enum 钉住封闭目标', () => {
    const fields = new SessionSandboxController(makeSandboxedCtx()).schemaFields()
    expect(fields.sandbox_permissions.type).toBe('string')
    expect(fields.sandbox_permissions.enum.length).toBeGreaterThan(0)
    expect(fields.justification.type).toBe('string')
  })
})

describe('SessionSandboxController.resolveEscalation', () => {
  it('无提权请求时直接通过', async () => {
    const c = new SessionSandboxController(makeCtx())
    await expect(c.resolveEscalation('create_session', {}, {} as any)).resolves.toBeUndefined()
  })

  it('无沙箱但请求提权时抛错', async () => {
    const c = new SessionSandboxController(makeCtx())
    await expect(
      c.resolveEscalation('create_session', { sandbox_permissions: 'danger-full-access', justification: '测试' }, {} as any),
    ).rejects.toThrow()
  })

  it('提权参数缺 justification 时抛错（配对校验）', async () => {
    const c = new SessionSandboxController(makeSandboxedCtx())
    await expect(c.resolveEscalation('create_session', { sandbox_permissions: 'danger-full-access' }, {} as any)).rejects.toThrow()
  })

  it('无 agent 的提权请求 fail-closed 拒绝', async () => {
    const approver = {
      request: async () => 'allowed-once',
    }
    const c = new SessionSandboxController(makeSandboxedCtx(approver))
    const exec = { agent: undefined, callId: 'call-1', signal: new AbortController().signal } as any
    await expect(
      c.resolveEscalation('create_session', { sandbox_permissions: 'danger-full-access', justification: '需要访问会话存储' }, exec),
    ).rejects.toThrow()
  })

  it('提权请求经审批通过后 resolve', async () => {
    let approved = false
    const approver = {
      request: async () => { approved = true; return 'allowed-once' },
    }
    const c = new SessionSandboxController(makeSandboxedCtx(approver))
    const exec = {
      agent: { session: { header: { id: 'session-1', cwd: '/ws' } } },
      callId: 'call-1',
      signal: new AbortController().signal,
    } as any
    await expect(
      c.resolveEscalation('create_session', { sandbox_permissions: 'danger-full-access', justification: '需要访问会话存储' }, exec),
    ).resolves.toBeUndefined()
    expect(approved).toBe(true)
  })
})
