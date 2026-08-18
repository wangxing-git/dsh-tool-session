/**
 * 会话工具集入口：注册全部 7 个会话管理工具。
 *
 * @module dsh-tool-session/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionSandboxController } from '../sandbox.js'
import type { ToolDeps } from '../value.js'
import { applyCreateTool } from './create.js'
import { applyRenameTool } from './rename.js'
import { applyArchiveTool } from './archive.js'
import { applySwitchTool } from './switch.js'
import { applyListTool } from './list.js'
import { applyCurrentTool } from './current.js'
import { applyGetTool } from './get.js'

/** 注册全部 7 个会话管理工具。 */
export function registerSessionTools(ctx: Context, sandbox: SessionSandboxController, deps: ToolDeps): void {
  applyCreateTool(ctx, sandbox, deps)
  applyRenameTool(ctx, sandbox, deps)
  applyArchiveTool(ctx, sandbox, deps)
  applySwitchTool(ctx, sandbox, deps)
  applyListTool(ctx, sandbox, deps)
  applyCurrentTool(ctx, sandbox, deps)
  applyGetTool(ctx, sandbox, deps)
}
