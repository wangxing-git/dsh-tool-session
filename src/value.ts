/**
 * dsh-tool-session 共享值域：各工具执行器共享的可选服务访问器、会话 id 生成、
 * 会话寻址性判断、create_session 目标解析，以及会话摘要的共享 output schema。
 *
 * @module dsh-tool-session/value
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { WorkspaceId, type Workspace, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { SwitchIntent } from './switch.js'

/** 各工具执行器共享的可选服务访问器与切换意图。 */
export interface ToolDeps {
  sessionTitle: () => SessionTitleService | undefined
  workspaceRegistry: () => WorkspaceRegistry | undefined
  agentDefaultModel: () => AgentDefaultModelConfig | undefined
  switchIntent: SwitchIntent
}

/** 生成新会话 id（与 DSH 持久化目录 session-<uuid> 对齐）。 */
export function newSessionId(): SessionId {
  return SessionId('session-' + randomUUID())
}

/** 会话是否可寻址（live 或 workspace 索引或已归档）；用于 switch/get 的存在性校验。 */
export function sessionExists(sid: SessionId, ctx: Context, deps: ToolDeps): boolean {
  if (ctx.agents.get(sid) !== undefined) return true
  const registry = deps.workspaceRegistry()
  if (registry === undefined) return false
  const key = String(sid)
  if (registry.archivedSessionIds.some((id) => String(id) === key)) return true
  for (const workspace of registry.list()) {
    if (workspace.sessionIds.some((id) => String(id) === key)) return true
  }
  return false
}

/** create_session 的目标：解析出的工作目录，以及（显式指定或默认匹配时）待归属的工作区。 */
export interface CreateTarget {
  cwd: string
  workspace?: Workspace
}

/**
 * 解析 create_session 的目标：cwd 优先，其次 workspace_id → path，最后回退当前会话 cwd。
 * 工作区归属：显式 workspace_id 优先，否则默认匹配 path === cwd 的工作区（通常是当前工作区）。
 */
export function resolveCreateTarget(args: { cwd?: string; workspace_id?: string }, exec: { agent?: { session: Session } | undefined }, deps: ToolDeps): CreateTarget {
  const registry = deps.workspaceRegistry()
  let cwd: string
  let workspace: Workspace | undefined

  if (args.cwd !== undefined && args.cwd.trim() !== '') {
    cwd = args.cwd.trim()
    if (!isAbsolute(cwd)) throw new Error(`cwd must be an absolute path: ${args.cwd}`)
  } else if (args.workspace_id !== undefined && args.workspace_id !== '') {
    if (registry === undefined) throw new Error('workspace-unavailable: cannot resolve workspace_id')
    workspace = registry.get(WorkspaceId(args.workspace_id))
    if (workspace === undefined) throw new Error(`workspace not found: ${args.workspace_id}`)
    cwd = workspace.path
  } else {
    const inherited = exec.agent?.session.header.cwd
    if (inherited === undefined) throw new Error('cwd is required: provide cwd or workspace_id, or create from a session that has a cwd')
    cwd = inherited
  }

  // 默认归属：未显式指定 workspace_id 时，回退到 path === cwd 的工作区。
  if (workspace === undefined && registry !== undefined) {
    workspace = registry.list().find((ws) => ws.path === cwd)
  }

  return { cwd, workspace }
}

/** 会话摘要的共享 output schema：get_session 的单对象与 list_sessions 的数组项共用。 */
export const SESSION_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true, description: '会话 id。' },
    title: { type: 'string', description: '会话标题（显式标题）。' },
    cwd: { type: 'string', description: '会话工作目录。' },
    running: { type: 'boolean', required: true, description: '会话 agent 是否 live。' },
    archived: { type: 'boolean', required: true, description: '会话是否已归档。' },
    workspace_id: { type: 'string', description: '归属工作区 id。' },
    workspace_title: { type: 'string', description: '归属工作区标题。' },
  },
} as const satisfies ValueSchemaSpec

/** 工具结果统一以格式化 JSON 文本返回（缩进 2 空格；模型直接读取结构化结果，替代人类可读的文本摘要）。 */
export function renderJsonOutput(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}
