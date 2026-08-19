import { describe, expect, it } from 'vitest'
import { registerSessionCommands } from '../src/commands.js'
import { SwitchIntent } from '../src/switch.js'
import type { ToolDeps } from '../src/value.js'

interface CommandDef {
  name: string
  description: string
  handler: (invocation: any) => Promise<any> | any
}

/** 构造 mock cmdCtx：记录注册的命令定义，effect 立即执行 generator 收集 disposers。 */
function makeCmdCtx() {
  const registered: CommandDef[] = []
  const commands = {
    register: (def: CommandDef) => {
      registered.push(def)
      return () => {}
    },
  }
  let disposers: Array<() => unknown> = []
  const cmdCtx: any = {
    commands,
    effect: (execute: () => Iterable<() => unknown>) => {
      const it = execute()
      const yielded: Array<() => unknown> = []
      let step = it.next()
      while (!step.done) {
        yielded.push(step.value)
        step = it.next()
      }
      disposers = yielded
      return () => {}
    },
  }
  return { cmdCtx, registered, getDisposers: () => disposers }
}

/** 构造外层 ctx：inject 默认立即回调（模拟 commands 已就绪），ready:false 时不回调。 */
function makeCtx(opts: { ready?: boolean } = {}) {
  const { cmdCtx, registered } = makeCmdCtx()
  const createOptions: any[] = []
  const followups: any[] = []
  const injectCalls: string[][] = []
  const ctx: any = {
    inject: (deps: string[], callback: Function) => {
      injectCalls.push(deps)
      if (opts.ready !== false) callback(cmdCtx)
      return {} as any
    },
    agents: {
      create: async (options: any) => {
        createOptions.push(options)
        return {
          agent: {
            session: { header: { id: 'session-new', cwd: options.meta?.cwd } },
            followup: (msg: any) => { followups.push(msg) },
          },
        }
      },
    },
    get: () => undefined,
  }
  return { ctx, registered, createOptions, followups, injectCalls }
}

/** 默认模型 stub：命令创建会话时需要 seed 路由（provider/model）。 */
const FAKE_DEFAULT_MODEL = { currentSelection: () => ({ provider: 'deepseek', model: 'test-model' }) }

/** 标准 deps：可选服务均缺失；可注入 workspaceRegistry。 */
function makeDeps(switchIntent = new SwitchIntent(), workspaceRegistry?: ToolDeps['workspaceRegistry']): ToolDeps {
  return { sessionTitle: () => undefined, workspaceRegistry: workspaceRegistry ?? (() => undefined), agentDefaultModel: () => FAKE_DEFAULT_MODEL as any, switchIntent }
}

/** 命令 invocation：当前会话 cwd=/ws、preset=code、无额外输入、未中止。 */
function invocation(overrides: any = {}) {
  return {
    commandId: 'cmd-1',
    agent: { session: { header: { id: 'session-current', cwd: '/ws', agentPreset: 'code' }, events: [] } },
    rawInput: '',
    signal: new AbortController().signal,
    ...overrides,
  }
}

function getCmd(registered: CommandDef[], name: string): CommandDef {
  const cmd = registered.find((c) => c.name === name)
  if (cmd === undefined) throw new Error('command not registered: ' + name)
  return cmd
}

describe('registerSessionCommands', () => {
  it('commands 服务就绪时注册 clear 与 new 两个命令', () => {
    const { ctx, registered, injectCalls } = makeCtx()
    registerSessionCommands(ctx, makeDeps())
    expect(injectCalls).toEqual([['commands']])
    expect(registered.map((c) => c.name).sort()).toEqual(['clear', 'new'])
  })

  it('commands 服务未就绪时不注册任何命令', () => {
    const { ctx, registered } = makeCtx({ ready: false })
    registerSessionCommands(ctx, makeDeps())
    expect(registered).toEqual([])
  })

  it('clear 无参数时创建新会话并请求 UI 切换', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    const intent = new SwitchIntent()
    registerSessionCommands(ctx, makeDeps(intent))
    const result = await getCmd(registered, 'clear').handler(invocation())
    expect(result.kind).toBe('success')
    expect(createOptions).toHaveLength(1)
    expect(createOptions[0].meta.cwd).toBe('/ws')
    expect(createOptions[0].meta.agentPreset).toBe('code')
    expect(intent.consume()).toMatch(/^session-/)
  })

  it('new 同样创建新会话并请求 UI 切换', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    const intent = new SwitchIntent()
    registerSessionCommands(ctx, makeDeps(intent))
    const result = await getCmd(registered, 'new').handler(invocation())
    expect(result.kind).toBe('success')
    expect(createOptions).toHaveLength(1)
    expect(intent.consume()).toMatch(/^session-/)
  })

  it('带参数时返回 usage 错误且不创建会话', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    registerSessionCommands(ctx, makeDeps())
    const result = await getCmd(registered, 'clear').handler(invocation({ rawInput: '  foo bar ' }))
    expect(result).toEqual({ kind: 'error', text: 'Usage: /clear (no arguments)' })
    expect(createOptions).toHaveLength(0)
  })

  it('当前会话无 cwd 时返回错误且不创建会话', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    registerSessionCommands(ctx, makeDeps())
    const agent = { session: { header: { id: 'session-current', agentPreset: 'code' }, events: [] } }
    const result = await getCmd(registered, 'clear').handler(invocation({ agent }))
    expect(result.kind).toBe('error')
    expect(createOptions).toHaveLength(0)
  })

  it('继承 preset/selected 事件后的 preset（非 header 值）', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    registerSessionCommands(ctx, makeDeps())
    const agent = {
      session: {
        header: { id: 'session-current', cwd: '/ws', agentPreset: 'code' },
        events: [{ type: 'agent-preset/selected', data: { agentPreset: 'minimal' } }],
      },
    }
    await getCmd(registered, 'clear').handler(invocation({ agent }))
    expect(createOptions[0].meta.agentPreset).toBe('minimal')
  })

  it('归属 path===cwd 的工作区', async () => {
    const { ctx, registered } = makeCtx()
    const attached: string[] = []
    const workspace = { path: '/ws', attachSession: async (id: string) => { attached.push(id) } }
    const registry = { list: () => [workspace], archivedSessionIds: [], archiveSession: async () => {} }
    registerSessionCommands(ctx, makeDeps(new SwitchIntent(), () => registry as any))
    await getCmd(registered, 'clear').handler(invocation())
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatch(/^session-/)
  })

  it('信号已中止时返回取消错误且不创建会话', async () => {
    const { ctx, registered, createOptions } = makeCtx()
    registerSessionCommands(ctx, makeDeps())
    const controller = new AbortController()
    controller.abort()
    const result = await getCmd(registered, 'clear').handler(invocation({ signal: controller.signal }))
    expect(result).toEqual({ kind: 'error', text: 'New session cancelled.' })
    expect(createOptions).toHaveLength(0)
  })
})
