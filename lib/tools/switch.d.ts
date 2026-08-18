/**
 * switch_session 工具：切换 UI 到目标会话。幂等（已是当前会话时直接返回）。
 *
 * @module dsh-tool-session/tools/switch
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionSandboxController } from '../sandbox.js';
import { type ToolDeps } from '../value.js';
export declare function applySwitchTool(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void;
