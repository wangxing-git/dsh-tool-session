/**
 * get_session 工具：按 session_id 查看单个会话信息（cwd/title/running/archived/workspace 归属）。只读。
 *
 * @module dsh-tool-session/tools/get
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyGetTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
