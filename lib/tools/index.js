import { applyCreateTool } from './create.js';
import { applyRenameTool } from './rename.js';
import { applyArchiveTool } from './archive.js';
import { applySwitchTool } from './switch.js';
import { applyListTool } from './list.js';
import { applyCurrentTool } from './current.js';
import { applyGetTool } from './get.js';
/** 注册全部 7 个会话管理工具。 */
export function registerSessionTools(ctx, sandbox, deps) {
    applyCreateTool(ctx, sandbox, deps);
    applyRenameTool(ctx, sandbox, deps);
    applyArchiveTool(ctx, sandbox, deps);
    applySwitchTool(ctx, sandbox, deps);
    applyListTool(ctx, sandbox, deps);
    applyCurrentTool(ctx, sandbox, deps);
    applyGetTool(ctx, sandbox, deps);
}
