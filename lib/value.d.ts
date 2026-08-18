/**
 * dsh-tool-session 共享值域：各工具执行器共享的可选服务访问器、会话 id 生成、
 * 会话寻址性判断、create_session 目标解析，以及会话摘要的共享 output schema。
 *
 * @module dsh-tool-session/value
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionId, type Session } from '@deepseek-ai/dsh-session';
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title';
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model';
import { type Workspace, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { SwitchIntent } from './switch.js';
/** 各工具执行器共享的可选服务访问器与切换意图。 */
export interface ToolDeps {
    sessionTitle: () => SessionTitleService | undefined;
    workspaceRegistry: () => WorkspaceRegistry | undefined;
    agentDefaultModel: () => AgentDefaultModelConfig | undefined;
    switchIntent: SwitchIntent;
}
/** 生成新会话 id（与 DSH 持久化目录 session-<uuid> 对齐）。 */
export declare function newSessionId(): SessionId;
/** 会话是否可寻址（live 或 workspace 索引或已归档）；用于 switch/get 的存在性校验。 */
export declare function sessionExists(sid: SessionId, ctx: Context, deps: ToolDeps): boolean;
/** create_session 的目标：解析出的工作目录，以及（显式指定或默认匹配时）待归属的工作区。 */
export interface CreateTarget {
    cwd: string;
    workspace?: Workspace;
}
/**
 * 解析 create_session 的目标：cwd 优先，其次 workspace_id → path，最后回退当前会话 cwd。
 * 工作区归属：显式 workspace_id 优先，否则默认匹配 path === cwd 的工作区（通常是当前工作区）。
 */
export declare function resolveCreateTarget(args: {
    cwd?: string;
    workspace_id?: string;
}, exec: {
    agent?: {
        session: Session;
    } | undefined;
}, deps: ToolDeps): CreateTarget;
/** 会话摘要的共享 output schema：get_session 的单对象与 list_sessions 的数组项共用。 */
export declare const SESSION_SUMMARY_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly session_id: {
            readonly type: "string";
            readonly required: true;
            readonly description: "会话 id。";
        };
        readonly title: {
            readonly type: "string";
            readonly description: "会话标题（显式标题）。";
        };
        readonly cwd: {
            readonly type: "string";
            readonly description: "会话工作目录。";
        };
        readonly running: {
            readonly type: "boolean";
            readonly required: true;
            readonly description: "会话 agent 是否 live。";
        };
        readonly archived: {
            readonly type: "boolean";
            readonly required: true;
            readonly description: "会话是否已归档。";
        };
        readonly workspace_id: {
            readonly type: "string";
            readonly description: "归属工作区 id。";
        };
        readonly workspace_title: {
            readonly type: "string";
            readonly description: "归属工作区标题。";
        };
    };
};
/** 工具结果统一以格式化 JSON 文本返回（缩进 2 空格；模型直接读取结构化结果，替代人类可读的文本摘要）。 */
export declare function renderJsonOutput(_args: unknown, value: unknown): {
    type: 'text';
    text: string;
}[];
