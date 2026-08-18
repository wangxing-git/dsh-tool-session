/** 请求一次归档审批；非 allowed-once 一律抛错（fail-closed）。 */
export async function requestArchiveApproval(ctx, sessionId, exec) {
    const approval = ctx.get('approval');
    if (approval === undefined) {
        throw new Error('archive requires approval, but no approval service is mounted');
    }
    if (exec.agent === undefined) {
        throw new Error('archive requires approval, but the call has no agent to route it through');
    }
    const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'archive_session',
        callId: exec.callId,
        reason: `归档会话 ${sessionId}：从会话列表隐藏（持久化日志保留、可恢复）`,
        signal: exec.signal,
    });
    if (outcome !== 'allowed-once') {
        throw new Error(`archive not approved: ${outcome}`);
    }
}
