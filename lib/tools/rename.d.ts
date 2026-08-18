/**
 * rename_session 工具：重命名会话（显式标题，钉住自动标题生成）。
 *
 * @module dsh-tool-session/tools/rename
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyRenameTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
