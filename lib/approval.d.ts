/**
 * 归档审批：归档是破坏性操作（把会话从列表隐藏），默认必须经用户审批，批准后才执行。
 * 无审批服务或无 agent 时 fail-closed 拒绝；审批被拒/取消/不可答均不归档。
 *
 * @module dsh-tool-session/approval
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
/** 请求一次归档审批；非 allowed-once 一律抛错（fail-closed）。 */
export declare function requestArchiveApproval(ctx: Context, sessionId: string, exec: ToolRunContext): Promise<void>;
