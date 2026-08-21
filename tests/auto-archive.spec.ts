import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AutoArchiveController, registerAutoArchive, type AutoArchiveConfig } from '../src/auto-archive.js'

const DAY = 86_400_000
const NOW = 1000 * DAY

const ENABLED: AutoArchiveConfig = { enabled: true, maxAgeDays: 30, maxSessionsPerWorkspace: 30 }

/** 构造持久化 header。 */
function header(id: string, createdAt: number) {
  return { version: 0, id: SessionId(id), createdAt } as any
}

/** 构造一条人类消息事件（时间戳 = 会话最后活跃时间）。 */
function promptEvent(time: number) {
  return { type: 'user/message', seq: 1, time, data: { source: { kind: 'user' } } } as any
}

/** 构造 persistence mock：list 返回 headers，readFrom 返回该 id 的事件。 */
function makePersistence(headers: any[], eventsBy: Map<string, any[]>) {
  return {
    list: async () => headers,
    readFrom: async (id: any) => ({ meta: headers.find((h) => String(h.id) === String(id)), events: eventsBy.get(String(id)) ?? [] }),
  }
}

/** 构造 registry mock：记录归档调用。 */
function makeRegistry(workspaces: any[], archivedIds: string[]) {
  const archivedCalls: string[] = []
  const archived = new Set(archivedIds)
  return {
    archivedSessionIds: [...archived],
    list: () => workspaces,
    archiveSession: async (id: any) => { archivedCalls.push(String(id)); archived.add(String(id)) },
    archivedCalls,
  }
}

/** 构造最小 ctx：get 返回 registry/persistence/projectionCache，agents.list 返回 live 会话，on 捕获监听器。 */
function makeCtx(opts: { registry?: any; persistence?: any; liveIds?: string[]; projectionCache?: any } = {}) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {}
  return {
    get: (name: string) => (name === 'workspaceRegistry' ? opts.registry : name === 'sessionPersistence' ? opts.persistence : name === 'sessionProjectionCache' ? opts.projectionCache : undefined),
    agents: { list: () => (opts.liveIds ?? []).map((id) => ({ id })) },
    logger: { warn: () => {}, info: () => {} },
    on: (event: string, fn: (...args: any[]) => void) => { (listeners[event] ??= []).push(fn); return () => {} },
    listeners,
  } as any
}

describe('AutoArchiveController.scan', () => {
  it('开关关闭时不归档任何会话', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1'] }], [])
    const persistence = makePersistence([header('s1', NOW - 40 * DAY)], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, enabled: false }))

    await expect(controller.scan(NOW)).resolves.toEqual([])
    expect(registry.archivedCalls).toEqual([])
  })

  it('缺 registry 或 persistence 时静默跳过', async () => {
    const ctx = makeCtx({})
    const controller = new AutoArchiveController(ctx, () => (ENABLED))
    await expect(controller.scan(NOW)).resolves.toEqual([])
  })

  it('组内数量 ≤ 上限时不归档（即使存在超龄会话）', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1', 's2', 's3'] }], [])
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY),
      header('s2', NOW - 35 * DAY),
      header('s3', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 3 }))

    await expect(controller.scan(NOW)).resolves.toEqual([])
    expect(registry.archivedCalls).toEqual([])
  })

  it('组内数量超限时归档最旧的到恰好 ≤ 上限', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1', 's2', 's3', 's4'] }], [])
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY),
      header('s2', NOW - 30 * DAY),
      header('s3', NOW - 20 * DAY),
      header('s4', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 2 }))

    await expect(controller.scan(NOW)).resolves.toEqual(['s1', 's2'])
  })

  it('过期优先：过期会话不足时继续归档最旧的未过期会话', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1', 's2', 's3'] }], [])
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY), // 过期
      header('s2', NOW - 5 * DAY),  // 未过期
      header('s3', NOW - 3 * DAY),  // 未过期
    ], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // excess = 2：归档 s1（过期）+ s2（未过期但最旧），凑到 ≤ 1
    await expect(controller.scan(NOW)).resolves.toEqual(['s1', 's2'])
  })

  it('live 与已归档不参与归档，但 live 占未归档席位', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1', 's2', 's3', 's4'] }], ['s3'])
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY),
      header('s2', NOW - 30 * DAY), // live，占位、不可归档
      header('s3', NOW - 20 * DAY), // 已归档，不计入
      header('s4', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence, liveIds: ['s2'] })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // 未归档 = s1、s2(live)、s4 共 3 个，超限 2；可归档候选 = s1、s4，归档到只剩 live
    await expect(controller.scan(NOW)).resolves.toEqual(['s1', 's4'])
  })

  it('新建 live 会话使组超限时，归档最旧的 cold 会话', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['old-cold', 'new-live'] }], [])
    const persistence = makePersistence([
      header('old-cold', NOW - 40 * DAY),
      header('new-live', NOW - 1 * DAY), // live，占位、不可归档
    ], new Map())
    const ctx = makeCtx({ registry, persistence, liveIds: ['new-live'] })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // 未归档 = old-cold + new-live(live) 共 2 个，超限 1；可归档候选 = old-cold，归档它
    await expect(controller.scan(NOW)).resolves.toEqual(['old-cold'])
  })

  it('未分组会话独立成组、独立套用规则', async () => {
    const registry = makeRegistry([], [])
    const persistence = makePersistence([
      header('u1', NOW - 40 * DAY),
      header('u2', NOW - 30 * DAY),
      header('u3', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 2 }))

    await expect(controller.scan(NOW)).resolves.toEqual(['u1'])
  })

  it('单会话归档抛错时跳过并继续归档其余', async () => {
    const workspaces = [{ id: 'w1', sessionIds: ['s1', 's2', 's3'] }]
    const archivedIds: string[] = []
    const archivedCalls: string[] = []
    const registry = {
      archivedSessionIds: archivedIds,
      list: () => workspaces,
      archiveSession: async (id: any) => {
        if (String(id) === 's1') throw new Error('boom')
        archivedCalls.push(String(id))
      },
    }
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY),
      header('s2', NOW - 30 * DAY),
      header('s3', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // excess = 2：s1 抛错跳过，s2 成功归档；结果只含成功归档的 s2
    await expect(controller.scan(NOW)).resolves.toEqual(['s2'])
    expect(archivedCalls).toEqual(['s2'])
  })

  it('活跃时间取 max(创建时间, 最后人类消息时间)', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['old-active', 'recent'] }], [])
    const eventsBy = new Map<string, any[]>([
      ['old-active', [promptEvent(NOW - 1 * DAY)]], // 创建很久但最近活跃
    ])
    const persistence = makePersistence([
      header('old-active', NOW - 40 * DAY),
      header('recent', NOW - 20 * DAY),
    ], eventsBy)
    const ctx = makeCtx({ registry, persistence })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // old-active 最近活跃（updatedAt = NOW-1天，未过期），recent 更旧（NOW-20天）
    // 排序按 updatedAt 升序：recent(旧) 在前 → 归档 recent
    await expect(controller.scan(NOW)).resolves.toEqual(['recent'])
  })

  it('优先用投影缓存的 lastPromptAt，不读完整日志', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['old-active', 'recent'] }], [])
    // eventsBy 为空：若退回 readFrom 读日志，lastPromptAt 恒为 0，会误把 old-active 判为最旧
    const persistence = makePersistence([
      header('old-active', NOW - 40 * DAY),
      header('recent', NOW - 20 * DAY),
    ], new Map())
    const projectionCache = {
      cachedSnapshot: (meta: any) => ({
        values: {
          sessionListMetadata: { blank: false, lastPromptAt: String(meta.id) === 'old-active' ? NOW - 1 * DAY : null },
        },
      }),
      coldSnapshot: async () => undefined,
    }
    const ctx = makeCtx({ registry, persistence, projectionCache })
    const controller = new AutoArchiveController(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    // 缓存给 old-active 最近活跃（updatedAt = NOW-1天），recent 无人类消息（updatedAt = NOW-20天）
    // 排序升序：recent 更旧 → 归档 recent；若走降级读日志则会归档 old-active
    await expect(controller.scan(NOW)).resolves.toEqual(['recent'])
  })
})

describe('registerAutoArchive 触发接线', () => {
  it('注册 session/created 监听器，同步不抛错，异步触发扫描', async () => {
    const registry = makeRegistry([{ id: 'w1', sessionIds: ['s1', 's2'] }], [])
    const persistence = makePersistence([
      header('s1', NOW - 40 * DAY),
      header('s2', NOW - 10 * DAY),
    ], new Map())
    const ctx = makeCtx({ registry, persistence })

    registerAutoArchive(ctx, () => ({ ...ENABLED, maxSessionsPerWorkspace: 1 }))

    const created = ctx.listeners['session/created']
    expect(created).toHaveLength(1)
    // 同步调用监听器不得抛错
    expect(() => created![0]()).not.toThrow()
    // 扫描在微任务中异步执行：等待若干微任务后断言归档发生
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.archivedCalls).toEqual(['s1'])
  })
})

