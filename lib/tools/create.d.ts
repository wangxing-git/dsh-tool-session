/**
 * create_session 工具：创建新会话，可选归属工作区、设置标题、发起首轮对话、切换 UI。
 *
 * @module dsh-tool-session/tools/create
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applyCreateTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
