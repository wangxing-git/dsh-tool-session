import { SessionId } from '@deepseek-ai/dsh-session';
import { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, sep } from 'node:path';
/** 生成新会话 id（与 DSH 持久化目录 session-<uuid> 对齐）。 */
export function newSessionId() {
    return SessionId('session-' + randomUUID());
}
/** 会话是否可寻址（live 或 workspace 索引或已归档）；用于 switch/get 的存在性校验。 */
export function sessionExists(sid, ctx, deps) {
    if (ctx.agents.get(sid) !== undefined)
        return true;
    const registry = deps.workspaceRegistry();
    if (registry === undefined)
        return false;
    const key = String(sid);
    if (registry.archivedSessionIds.some((id) => String(id) === key))
        return true;
    for (const workspace of registry.list()) {
        if (workspace.sessionIds.some((id) => String(id) === key))
            return true;
    }
    return false;
}
/** realpath 归一；目录不存在或不可解析时返回 undefined（与 host attachSession 的校验同语义）。 */
async function realpathOrUndefined(path) {
    try {
        return await realpath(path);
    }
    catch {
        return undefined;
    }
}
/** 最接近的工作区路径（纯字符串前缀，含精确相等；仅用于错误提示，不参与归属判定）。 */
function nearestWorkspacePath(workspaces, cwd) {
    let best;
    for (const workspace of workspaces) {
        if (cwd === workspace.path || cwd.startsWith(workspace.path + sep)) {
            if (best === undefined || workspace.path.length > best.length)
                best = workspace.path;
        }
    }
    return best;
}
/**
 * cwd 未注册时的 fail-closed 错误：DSH 的 workspace.attachSession() 要求会话 cwd 的
 * realpath 精确等于工作区 path，子目录一律拒绝。与其创建出一个落在「未分组」、
 * 用户看不到的会话，不如让调用方（模型）改用已注册工作区路径或先注册该目录。
 */
function unregisteredCwdError(cwd, workspaces) {
    const nearest = nearestWorkspacePath(workspaces, cwd);
    const hint = nearest === undefined ? '' : ` Nearest registered workspace: ${nearest}.`;
    return new Error(`cwd is not a registered workspace: ${cwd}. create_session only creates sessions whose cwd equals a registered workspace path (DSH rejects attaching a session to a workspace when its cwd differs, subdirectories included).${hint} ` +
        'Pass a cwd that exactly equals a workspace path, or register this directory first (create_workspace) and retry; list_workspaces lists the registered paths.');
}
/**
 * 解析 create_session 的目标：cwd 优先，其次 workspace_id → path，最后回退当前会话 cwd。
 * 工作区归属 fail-closed：cwd（realpath 归一后）必须精确等于一个已注册工作区——
 * 显式 workspace_id 时校验 cwd 与该项路径一致；未指定时按 cwd 反查工作区。
 * 无 workspaceRegistry 服务（rosterless 部署）时无法校验，保持不归属。
 */
export async function resolveCreateTarget(args, exec, deps) {
    const registry = deps.workspaceRegistry();
    let cwd;
    let explicit;
    // workspace_id 与 cwd 可同时给出：先解析显式工作区，再解析 cwd 并校验两者一致，
    // 避免「传了 workspace_id 却被 cwd 分支静默忽略」。
    if (args.workspace_id !== undefined && args.workspace_id !== '') {
        if (registry === undefined)
            throw new Error('workspace-unavailable: cannot resolve workspace_id');
        explicit = registry.get(WorkspaceId(args.workspace_id));
        if (explicit === undefined)
            throw new Error(`workspace not found: ${args.workspace_id}`);
    }
    if (args.cwd !== undefined && args.cwd.trim() !== '') {
        cwd = args.cwd.trim();
        if (!isAbsolute(cwd))
            throw new Error(`cwd must be an absolute path: ${args.cwd}`);
    }
    else if (explicit !== undefined) {
        cwd = explicit.path;
    }
    else {
        const inherited = exec.agent?.session.header.cwd;
        if (inherited === undefined)
            throw new Error('cwd is required: provide cwd or workspace_id, or create from a session that has a cwd');
        cwd = inherited;
    }
    // 无 workspaceRegistry 服务（rosterless 部署）：没有工作区概念，不校验也不归属。
    if (registry === undefined)
        return { cwd };
    const resolved = await realpathOrUndefined(cwd);
    if (resolved === undefined)
        throw new Error(`cwd does not resolve to an existing directory: ${cwd}`);
    // 显式 workspace_id：cwd 必须与该项路径一致（否则 attach 必被 host 拒绝）。
    if (explicit !== undefined) {
        if (resolved !== explicit.path)
            throw new Error(`cwd does not match workspace ${String(explicit.id)} (${explicit.path}): ${cwd} resolves to ${resolved}`);
        return { cwd, workspace: explicit };
    }
    // 未指定 workspace_id：cwd 必须精确匹配一个已注册工作区。
    const workspace = registry.list().find((candidate) => candidate.path === resolved);
    if (workspace === undefined)
        throw unregisteredCwdError(cwd, registry.list());
    return { cwd, workspace };
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
};
/** 工具结果统一以格式化 JSON 文本返回（缩进 2 空格；模型直接读取结构化结果，替代人类可读的文本摘要）。 */
export function renderJsonOutput(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
