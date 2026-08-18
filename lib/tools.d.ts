/**
 * 5 个会话管理工具：session_create / session_rename / session_archive /
 * session_switch / session_list。全部经 `ctx.tools.register(defineTool(...))` 注册，
 * 执行前统一走 `SessionSandboxController.resolveEscalation`（沙箱挂载时提权审批），
 * 会话操作本身经 host 服务完成（`ctx.agents` / `ctx.sessionTitle` / `ctx.workspaceRegistry`）。
 *
 * @module dsh-tool-session/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model';
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title';
import { type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import { SessionSandboxController } from './sandbox.js';
import type { SwitchIntent } from './switch.js';
/** 各工具执行器共享的可选服务访问器与切换意图。 */
export interface ToolDeps {
    sessionTitle: () => SessionTitleService | undefined;
    workspaceRegistry: () => WorkspaceRegistry | undefined;
    agentDefaultModel: () => AgentDefaultModelConfig | undefined;
    switchIntent: SwitchIntent;
}
/** 注册全部 6 个会话管理工具。 */
export declare function registerSessionTools(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
