/**
 * list_sessions 工具：列出会话（id/title/cwd/running/archived/workspace 归属）。
 * 归档会话默认隐藏，除非 include_archived 为 true。
 *
 * @module dsh-tool-session/tools/list
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyListTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
