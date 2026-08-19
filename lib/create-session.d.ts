/**
 * create_session 工具与 /clear、/new 命令共享的「创建会话」核心：
 * 在 preset 已解析之后，以给定的 cwd + preset id 创建会话、归属工作区、
 * 可选设置标题 / 发起首轮对话 / 切换 UI。
 *
 * 与 create_session 工具的差异：本函数不承担沙箱提权（那是工具参数层面的
 * fail-closed 审批，命令在 UI 命令平面执行、不经过工具执行器），也不承担
 * preset 的「用户指定或默认」解析——调用方（工具 / 命令）各自解析好 preset id
 * 再传入，本函数只负责把一次创建做完整。
 *
 * @module dsh-tool-session/create-session
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
import { type ToolDeps } from './value.js';
/** 创建会话所需的、已经解析好的目标参数。 */
export interface CreateSessionParams {
    /** 新会话工作目录（绝对路径）。 */
    cwd: string;
    /** 归属工作区（可选；path === cwd 时由调用方预先匹配）。 */
    workspace?: Workspace;
    /** 已解析的 agent preset id（undefined = 不挂 preset，rosterless 部署）。 */
    presetId?: string;
    /** 显式标题（空白视为未设置）。 */
    title?: string;
    /** 首轮用户消息（空白视为未设置）。 */
    initialMessage?: string;
    /** 创建后切换 UI 到新会话。 */
    switch?: boolean;
}
/** 创建结果：新会话 id，以及（可选）设置的标题 / 挂载的 preset id。 */
export interface CreateSessionResult {
    sessionId: SessionId;
    title?: string;
    presetId?: string;
}
/**
 * 以给定参数创建会话并完成归属 / 标题 / 首轮 / 切换。
 * 会话创建经 host 服务（ctx.agents / ctx.sessionTitle / ctx.workspaceRegistry）
 * 完成，不直接碰会话持久化文件；缺 model selection 服务时 fail-closed 拒绝。
 */
export declare function createSession(ctx: Context, deps: ToolDeps, params: CreateSessionParams): Promise<CreateSessionResult>;
