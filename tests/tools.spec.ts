import { describe, expect, it } from 'vitest'
import { registerSessionTools } from '../src/tools/index.js'
import { SessionSandboxController } from '../src/sandbox.js'
import { SwitchIntent } from '../src/switch.js'
import { renderJsonOutput, type ToolDeps } from '../src/value.js'

interface ToolDef {
  name: string
  execute(args: unknown, exec: any): Promise<unknown>
}

/** 构造最小 mock ctx，捕获注册的工具定义；可选注入 approval（归档审批用）。 */
function makeCtx(approval?: unknown) {
  const registered: ToolDef[] = []
  const followups: unknown[] = []
  const createOptions: unknown[] = []
  return {
    tools: { register: (def: ToolDef) => { registered.push(def) } },
    agents: {
      get: () => undefined,
      list: () => [],
      create: async (options: unknown) => {
        createOptions.push(options)
        return {
          agent: {
            session: { header: { id: 'session-new', cwd: '/ws' } },
            followup: (msg: unknown) => { followups.push(msg) },
          },
        }
      },
    },
    get: (name: string) => (name === 'approval' ? approval : undefined),
    registered,
    followups,
    createOptions,
  }
}

/** 无沙箱的控制器。 */
function noSandbox(): SessionSandboxController {
  return new SessionSandboxController({ fs: { sandboxMode: undefined }, get: () => undefined } as any)
}

/** 标准 deps（可选服务均缺失）；可选注入 workspaceRegistry（归档成功用例）。 */
function makeDeps(switchIntent = new SwitchIntent(), workspaceRegistry?: ToolDeps['workspaceRegistry'], agentDefaultModel?: ToolDeps['agentDefaultModel']): ToolDeps {
  return { sessionTitle: () => undefined, workspaceRegistry: workspaceRegistry ?? (() => undefined), agentDefaultModel: agentDefaultModel ?? (() => undefined), switchIntent }
}

/** 当前会话的 exec 上下文。 */
function execFor(sessionId: string): any {
  return {
    agent: { id: sessionId, session: { header: { id: sessionId, cwd: '/ws' } } },
    callId: 'call-1',
    signal: new AbortController().signal,
  }
}

function getTool(registered: ToolDef[], name: string): ToolDef {
  const tool = registered.find((t) => t.name === name)
  if (tool === undefined) throw new Error('tool not registered: ' + name)
  return tool
}

describe('registerSessionTools', () => {
  it('注册 7 个会话工具', () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    expect(ctx.registered.map((t) => t.name).sort()).toEqual([
      'archive_session',
      'create_session',
      'get_current_session',
      'get_session',
      'list_sessions',
      'rename_session',
      'switch_session',
    ])
  })

  it('get_session 按 id 返回会话信息', async () => {
    const ctx = makeCtx()
    ctx.agents.get = (id: string) => (id === 'session-live' ? { session: { header: { id: 'session-live', cwd: '/ws' } } } : undefined)
    const titleService = { get: () => ({ title: '活会话' }) }
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws', title: '工作区', sessionIds: ['session-live'] }],
      archivedSessionIds: [],
      archiveSession: async () => {},
    }
    registerSessionTools(ctx as any, noSandbox(), { ...makeDeps(), sessionTitle: () => titleService as any, workspaceRegistry: () => registry as any })
    const tool = getTool(ctx.registered, 'get_session')
    const result = await tool.execute({ session_id: 'session-live' }, execFor('session-current'))
    expect(result).toEqual({
      session: {
        session_id: 'session-live',
        cwd: '/ws',
        title: '活会话',
        running: true,
        archived: false,
        workspace_id: 'ws-1',
        workspace_title: '工作区',
      },
    })
  })

  it('get_session 未知会话抛 session-not-found', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'get_session')
    await expect(tool.execute({ session_id: 'session-missing' }, execFor('session-current'))).rejects.toThrow('session not found')
  })

  it('get_current_session 返回当前会话信息与工作区归属', async () => {
    const ctx = makeCtx()
    const titleService = { get: () => ({ title: '当前标题' }) }
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws', title: '我的工作区', sessionIds: ['session-current'] }],
      archivedSessionIds: [],
      archiveSession: async () => {},
    }
    registerSessionTools(ctx as any, noSandbox(), { ...makeDeps(), sessionTitle: () => titleService as any, workspaceRegistry: () => registry as any })
    const tool = getTool(ctx.registered, 'get_current_session')
    const result = await tool.execute({}, execFor('session-current'))
    expect(result).toEqual({
      session_id: 'session-current',
      cwd: '/ws',
      title: '当前标题',
      workspace_id: 'ws-1',
      workspace_title: '我的工作区',
    })
  })

  it('create_session 不传 workspace_id 时默认归属 path===cwd 的工作区', async () => {
    const ctx = makeCtx()
    const attached: string[] = []
    const workspace = { path: '/ws', attachSession: async (id: string) => { attached.push(id) } }
    const registry = { get: () => undefined, list: () => [workspace], archivedSessionIds: [], archiveSession: async () => {} }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'create_session')
    const result = await tool.execute({}, execFor('session-current'))
    expect(result.cwd).toBe('/ws')
    expect(attached).toHaveLength(1)
    expect(attached[0]).toBe(result.session_id)
  })

  it('create_session 带 initial_message 发起首轮对话', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'create_session')
    const result = await tool.execute({ cwd: '/ws', initial_message: '你好，请开始' }, execFor('session-current'))
    expect(result).toMatchObject({ cwd: '/ws', session_id: expect.stringMatching(/^session-/) })
    expect(ctx.followups).toHaveLength(1)
    const msg = ctx.followups[0] as any
    expect(msg.role).toBe('user')
    expect(msg.content).toEqual([{ type: 'text', text: '你好，请开始' }])
    expect(msg.source).toEqual({ kind: 'user' })
  })

  it('create_session 不带 initial_message 不发起首轮对话', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'create_session')
    await tool.execute({ cwd: '/ws' }, execFor('session-current'))
    expect(ctx.followups).toHaveLength(0)
  })

  it('create_session initial_message 为空白字符串不发起首轮对话', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'create_session')
    await tool.execute({ cwd: '/ws', initial_message: '   ' }, execFor('session-current'))
    expect(ctx.followups).toHaveLength(0)
  })

  it('create_session initial_message + switch 同时生效', async () => {
    const ctx = makeCtx()
    const intent = new SwitchIntent()
    registerSessionTools(ctx as any, noSandbox(), makeDeps(intent))
    const tool = getTool(ctx.registered, 'create_session')
    await tool.execute({ cwd: '/ws', initial_message: 'hi', switch: true }, execFor('session-current'))
    expect(ctx.followups).toHaveLength(1)
    expect(intent.consume()).toMatch(/^session-/)
  })

  it('create_session 通过 setup 安装 model selection', async () => {
    const ctx = makeCtx()
    const defaultModel = { currentSelection: () => ({ provider: 'deepseek', model: 'test-model' }) }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), undefined, () => defaultModel as any))
    const tool = getTool(ctx.registered, 'create_session')
    await tool.execute({ cwd: '/ws', initial_message: 'hi' }, execFor('session-current'))
    // create 收到 setup 回调
    const options = ctx.createOptions[0] as any
    expect(typeof options.setup).toBe('function')
    // 用 fake agentCtx 调用 setup，验证注册了 model selection 监听器
    const listeners: [string, Function][] = []
    const agentCtx = { on: (event: string, listener: Function) => { listeners.push([event, listener]); return () => {} } }
    options.setup(agentCtx)
    const events = listeners.map(([e]) => e)
    expect(events).toContain('system-prompt/assemble')
    expect(events).toContain('agent/request')
    // 调用 assemble 监听器，验证 variables 注入 provider/model
    const assemble = listeners.find(([e]) => e === 'system-prompt/assemble')![1]
    const assembled = await assemble({}, {}, async () => ({ variables: {} }))
    expect(assembled.variables).toEqual({ provider: 'deepseek', model: 'test-model' })
  })

  it('create_session 缺 agentDefaultModel 时 setup fail-closed', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps()) // agentDefaultModel 缺失
    const tool = getTool(ctx.registered, 'create_session')
    await tool.execute({ cwd: '/ws', initial_message: 'hi' }, execFor('session-current'))
    const options = ctx.createOptions[0] as any
    const agentCtx = { on: () => () => {} }
    expect(() => options.setup(agentCtx)).toThrow('agent-default-model-unavailable')
  })

  it('create_session 指定 workspace_id 时归属该 workspace', async () => {
    const ctx = makeCtx()
    const attached: string[] = []
    const workspace = { path: '/ws-workspace', attachSession: async (id: string) => { attached.push(id) } }
    const registry = { get: (id: string) => (id === 'ws-1' ? workspace : undefined), list: () => [], archivedSessionIds: [], archiveSession: async () => {} }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'create_session')
    const result = await tool.execute({ workspace_id: 'ws-1' }, execFor('session-current'))
    expect(result.cwd).toBe('/ws-workspace')
    expect(attached).toHaveLength(1)
    expect(attached[0]).toBe(result.session_id)
  })

  it('create_session workspace_id 不存在时抛 workspace-not-found', async () => {
    const ctx = makeCtx()
    const registry = { get: () => undefined, list: () => [], archivedSessionIds: [], archiveSession: async () => {} }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'create_session')
    await expect(tool.execute({ workspace_id: 'ws-missing' }, execFor('session-current'))).rejects.toThrow('workspace not found')
  })

  it('create_session cwd 为相对路径时抛错', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'create_session')
    await expect(tool.execute({ cwd: 'relative/path' }, execFor('session-current'))).rejects.toThrow('cwd must be an absolute path')
  })

  it('switch_session 到当前会话幂等返回', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'switch_session')
    const result = await tool.execute({ session_id: 'session-current' }, execFor('session-current'))
    expect(result).toEqual({ session_id: 'session-current', switched: true })
  })

  it('switch_session 到未知会话抛 session-not-found', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'switch_session')
    await expect(tool.execute({ session_id: 'session-missing' }, execFor('session-current'))).rejects.toThrow('session not found')
  })

  it('archive_session 拒绝归档当前活跃会话', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'archive_session')
    await expect(tool.execute({ session_id: 'session-current' }, execFor('session-current'))).rejects.toThrow('cannot archive the active session')
  })

  it('archive_session 审批被拒时抛错', async () => {
    const approval = { request: async () => 'rejected' }
    const ctx = makeCtx(approval)
    ctx.agents.get = (id: string) => (id === 'session-other' ? { session: { header: { id: 'session-other' } } } : undefined)
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'archive_session')
    await expect(tool.execute({ session_id: 'session-other' }, execFor('session-current'))).rejects.toThrow('archive not approved')
  })

  it('archive_session 无审批服务时 fail-closed 拒绝', async () => {
    const ctx = makeCtx() // approval 为 undefined
    ctx.agents.get = (id: string) => (id === 'session-other' ? { session: { header: { id: 'session-other' } } } : undefined)
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'archive_session')
    await expect(tool.execute({ session_id: 'session-other' }, execFor('session-current'))).rejects.toThrow('no approval service')
  })

  it('archive_session 审批通过后归档', async () => {
    let archivedId: string | undefined
    const approval = { request: async () => 'allowed-once' }
    const workspaceRegistry = { archiveSession: async (id: string) => { archivedId = id } }
    const ctx = makeCtx(approval)
    ctx.agents.get = (id: string) => (id === 'session-other' ? { session: { header: { id: 'session-other' } } } : undefined)
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => workspaceRegistry as any))
    const tool = getTool(ctx.registered, 'archive_session')
    const result = await tool.execute({ session_id: 'session-other' }, execFor('session-current'))
    expect(result).toEqual({ session_id: 'session-other', archived: true })
    expect(archivedId).toBe('session-other')
  })

  it('archive_session 归档不存在会话抛 session-not-found', async () => {
    const ctx = makeCtx() // agents.get 默认 undefined，registry 缺失
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'archive_session')
    await expect(tool.execute({ session_id: 'session-missing' }, execFor('session-current'))).rejects.toThrow('session not found')
  })

  it('rename_session 目标未加载抛 not-loaded', async () => {
    const ctx = makeCtx()
    registerSessionTools(ctx as any, noSandbox(), makeDeps())
    const tool = getTool(ctx.registered, 'rename_session')
    await expect(tool.execute({ session_id: 'session-cold', title: '新标题' }, execFor('session-current'))).rejects.toThrow('not loaded')
  })

  it('switch_session 记录切换意图', async () => {
    const ctx = makeCtx()
    const intent = new SwitchIntent()
    registerSessionTools(ctx as any, noSandbox(), makeDeps(intent))
    // 让 session-current 之外的目标存在：用 live agents 让 sessionExists 命中。
    ctx.agents.get = (id: string) => (id === 'session-other' ? { session: { header: { id: 'session-other' } } } : undefined)
    const tool = getTool(ctx.registered, 'switch_session')
    await tool.execute({ session_id: 'session-other' }, execFor('session-current'))
    expect(intent.consume()).toBe('session-other')
  })

  it('list_sessions include_archived 归档非 live 会话不输出 undefined cwd（lossless JSON）', async () => {
    const ctx = makeCtx()
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws', title: '工作区', sessionIds: [] }],
      archivedSessionIds: ['session-cold'],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({ include_archived: true }, execFor('session-current'))) as any
    const archived = result.sessions.find((s: any) => s.session_id === 'session-cold')
    expect(archived).toEqual({ session_id: 'session-cold', running: false, archived: true })
    // 关键回归：整个返回包 JSON 序列化不得出现 undefined 值（否则 worker 层拒绝为 non-lossless JSON）
    expect(JSON.stringify(result)).not.toContain('undefined')
  })

  it('list_sessions 默认隐藏归档会话', async () => {
    const ctx = makeCtx()
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws', title: '工作区', sessionIds: ['session-live'] }],
      archivedSessionIds: ['session-cold'],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({}, execFor('session-current'))) as any
    const ids = result.sessions.map((s: any) => s.session_id)
    expect(ids).toContain('session-live')
    expect(ids).not.toContain('session-cold')
  })

  it('list_sessions include_archived 归档 live 会话保留 cwd 与 running', async () => {
    const ctx = makeCtx()
    ctx.agents.list = () => [{ id: 'session-live-archived', session: { header: { id: 'session-live-archived', cwd: '/ws' } } }]
    const registry = {
      list: () => [],
      archivedSessionIds: ['session-live-archived'],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({ include_archived: true }, execFor('session-current'))) as any
    const archived = result.sessions.find((s: any) => s.session_id === 'session-live-archived')
    expect(archived).toEqual({ session_id: 'session-live-archived', cwd: '/ws', running: true, archived: true })
    expect(JSON.stringify(result)).not.toContain('undefined')
  })

  it('list_sessions workspace_id 只返回指定工作区的会话', async () => {
    const ctx = makeCtx()
    ctx.agents.list = () => [{ id: 'session-ws2', session: { header: { id: 'session-ws2', cwd: '/ws2' } } }]
    const registry = {
      list: () => [
        { id: 'ws-1', path: '/ws1', title: '工作区一', sessionIds: ['session-ws1-a', 'session-ws1-b'] },
        { id: 'ws-2', path: '/ws2', title: '工作区二', sessionIds: ['session-ws2'] },
      ],
      archivedSessionIds: [],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({ workspace_id: 'ws-1' }, execFor('session-current'))) as any
    const ids = result.sessions.map((s: any) => s.session_id).sort()
    expect(ids).toEqual(['session-ws1-a', 'session-ws1-b'])
  })

  it('list_sessions workspace_id 不存在的 id 返回空列表', async () => {
    const ctx = makeCtx()
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws1', title: '工作区一', sessionIds: ['session-ws1-a'] }],
      archivedSessionIds: [],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({ workspace_id: 'ws-missing' }, execFor('session-current'))) as any
    expect(result.sessions).toEqual([])
  })

  it('list_sessions workspace_id 过滤归档与孤儿会话（无归属不匹配）', async () => {
    const ctx = makeCtx()
    ctx.agents.list = () => [{ id: 'session-orphan', session: { header: { id: 'session-orphan', cwd: '/orphan' } } }]
    const registry = {
      list: () => [{ id: 'ws-1', path: '/ws1', title: '工作区一', sessionIds: ['session-ws1'] }],
      archivedSessionIds: ['session-cold'],
    }
    registerSessionTools(ctx as any, noSandbox(), makeDeps(new SwitchIntent(), () => registry as any))
    const tool = getTool(ctx.registered, 'list_sessions')
    const result = (await tool.execute({ workspace_id: 'ws-1', include_archived: true }, execFor('session-current'))) as any
    const ids = result.sessions.map((s: any) => s.session_id)
    expect(ids).toEqual(['session-ws1'])
  })
})

describe('renderJsonOutput 工具结果 JSON 化', () => {
  it('输出格式化 JSON 文本（缩进 2 空格）', () => {
    const blocks = renderJsonOutput(undefined, { session_id: 's1', archived: false })
    expect(blocks).toEqual([
      { type: 'text', text: '{\n  "session_id": "s1",\n  "archived": false\n}' },
    ])
  })

  it('数组与嵌套对象可被 JSON.parse 还原', () => {
    const blocks = renderJsonOutput(undefined, { sessions: [{ session_id: 'a', running: true }] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(JSON.parse(blocks[0].text)).toEqual({ sessions: [{ session_id: 'a', running: true }] })
  })
})
