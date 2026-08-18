/**
 * archive_session 工具：归档会话（删除需求的归档替代：文件保留、可恢复）。
 * 归档是破坏性操作，默认必须经用户审批，批准后才执行。
 *
 * @module dsh-tool-session/tools/archive
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyArchiveTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
