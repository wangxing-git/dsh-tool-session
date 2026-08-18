/**
 * get_session 工具：按 session_id 查看单个会话信息（cwd/title/running/archived/workspace 归属）。只读。
 *
 * @module dsh-tool-session/tools/get
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionSandboxController } from '../sandbox.js'
import { renderJsonOutput, SESSION_SUMMARY_SCHEMA, sessionExists, type ToolDeps } from '../value.js'

export function applyGetTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'get_session',
    description: 'Get information about a session by id: cwd, title, running/archived flags, and workspace membership. Read-only.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session id to look up.' },
      ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session: SESSION_SUMMARY_SCHEMA,
        },
      },
      render: renderJsonOutput,
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      await sandbox.resolveEscalation('get_session', args, exec)
      const sessionId = SessionId(args.session_id)
      if (!sessionExists(sessionId, ctx, deps)) {
        throw new Error(`session not found: ${args.session_id}`)
      }
      const agent = ctx.agents.get(sessionId)
      const registry = deps.workspaceRegistry()
      const sessionTitle = deps.sessionTitle()

      // cwd：live → header.cwd；否则取归属工作区的 path。
      let cwd: string | undefined = agent?.session.header.cwd
      let workspaceId: string | undefined
      let workspaceTitle: string | undefined
      if (registry !== undefined) {
        for (const ws of registry.list()) {
          if (ws.sessionIds.some((id) => String(id) === args.session_id)) {
            workspaceId = String(ws.id)
            workspaceTitle = ws.title
            if (cwd === undefined) cwd = ws.path
            break
          }
        }
      }
      const archived = registry !== undefined && registry.archivedSessionIds.some((id) => String(id) === args.session_id)
      const title = agent !== undefined && sessionTitle !== undefined ? sessionTitle.get(agent.session)?.title : undefined

      return {
        session: {
          session_id: args.session_id,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(title !== undefined ? { title } : {}),
          running: agent !== undefined,
          archived,
          ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
          ...(workspaceTitle !== undefined ? { workspace_title: workspaceTitle } : {}),
        },
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `查看会话 ${args.session_id}` }
    },
  }))
}
