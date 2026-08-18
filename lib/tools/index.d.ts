/**
 * 会话工具集入口：注册全部 7 个会话管理工具。
 *
 * @module dsh-tool-session/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionSandboxController } from '../sandbox.js';
import type { ToolDeps } from '../value.js';
/** 注册全部 7 个会话管理工具。 */
export declare function registerSessionTools(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
