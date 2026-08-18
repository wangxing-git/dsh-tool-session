/**
 * 归档审批：归档是破坏性操作（把会话从列表隐藏），默认必须经用户审批，批准后才执行。
 * 无审批服务或无 agent 时 fail-closed 拒绝；审批被拒/取消/不可答均不归档。
 *
 * @module dsh-tool-session/approval
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'

/** 请求一次归档审批；非 allowed-once 一律抛错（fail-closed）。 */
export async function requestArchiveApproval(ctx: Context, sessionId: string, exec: ToolRunContext): Promise<void> {
  const approval = ctx.get('approval') as ApprovalService | undefined
  if (approval === undefined) {
    throw new Error('archive requires approval, but no approval service is mounted')
  }
  if (exec.agent === undefined) {
    throw new Error('archive requires approval, but the call has no agent to route it through')
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: 'archive_session',
    callId: exec.callId,
    reason: `归档会话 ${sessionId}：从会话列表隐藏（持久化日志保留、可恢复）`,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`archive not approved: ${outcome}`)
  }
}
