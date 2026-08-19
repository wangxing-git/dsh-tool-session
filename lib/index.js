import z from '@deepseek-ai/schemastery';
import { SessionSandboxController } from './sandbox.js';
import { SwitchIntent, registerSwitchRpc } from './switch.js';
import { registerSessionTools } from './tools/index.js';
import { registerSessionCommands } from './commands.js';
export { SessionSandboxController } from './sandbox.js';
export { SwitchIntent } from './switch.js';
/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-session';
/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export const inject = ['tools', 'agents', 'fs'];
/** 插件配置 schema（与 dsh-tool-fs 同款 z<Config> 标注）。 */
export const Config = z.object({});
/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx, _config) {
    const sandbox = new SessionSandboxController(ctx);
    const switchIntent = new SwitchIntent();
    const deps = {
        sessionTitle: () => ctx.get('sessionTitle'),
        workspaceRegistry: () => ctx.get('workspaceRegistry'),
        agentDefaultModel: () => ctx.get('agentDefaultModel'),
        switchIntent,
    };
    registerSessionTools(ctx, sandbox, deps);
    registerSessionCommands(ctx, deps);
    registerSwitchRpc(ctx, switchIntent);
}
