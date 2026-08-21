/**
 * list_sessions 工具：列出会话（id/title/cwd/running/archived/workspace 归属）。
 * 归档会话默认隐藏；用 status 过滤（'archived' 或 'all'）查看。
 *
 * @module dsh-tool-session/tools/list
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyListTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
