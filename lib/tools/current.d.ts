/**
 * get_current_session 工具：返回当前会话（本 agent 运行所在会话）的身份与工作区归属信息。
 *
 * @module dsh-tool-session/tools/current
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyCurrentTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
