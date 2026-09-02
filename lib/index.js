import z from '@deepseek-ai/schemastery';
import { SessionSandboxController } from './sandbox.js';
import { SwitchIntent, registerSwitchEvents } from './switch.js';
import { registerSessionTools } from './tools/index.js';
import { registerSessionCommands } from './commands.js';
import { registerAutoArchive } from './auto-archive.js';
export { SessionSandboxController } from './sandbox.js';
export { SwitchIntent } from './switch.js';
/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-session';
/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export const inject = ['tools', 'agents', 'fs'];
/** 插件配置 schema（带默认值；autoArchive 默认关闭）。 */
export const Config = z.object({
    autoArchive: z.object({
        enabled: z.boolean().default(false),
        maxAgeDays: z.natural().min(1).default(30),
        maxSessionsPerWorkspace: z.natural().min(1).default(30),
    }).default({ enabled: false, maxAgeDays: 30, maxSessionsPerWorkspace: 30 }),
});
/** settings.yaml 顶层 namespace（插件短名 tool-session）。 */
export const SETTINGS_NAMESPACE = 'tool-session';
/** settings namespace schema：字段必填，base 层由 cordis config 解析提供。 */
const SettingsSchema = z.object({
    autoArchive: z.object({
        enabled: z.boolean().required(),
        maxAgeDays: z.natural().min(1).required(),
        maxSessionsPerWorkspace: z.natural().min(1).required(),
    }).required(),
});
/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx, config) {
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
    registerSwitchEvents(ctx, switchIntent);
    // 自动归档扫描：默认关闭，开启后在任何会话创建（session/created）时触发。
    // 配置优先级：settings.yaml（tool-session section，热生效）> cordis.patch.yml（base）> schema 默认。
    const resolve = (c) => ({
        autoArchive: {
            enabled: c.autoArchive?.enabled ?? false,
            maxAgeDays: c.autoArchive?.maxAgeDays ?? 30,
            maxSessionsPerWorkspace: c.autoArchive?.maxSessionsPerWorkspace ?? 30,
        },
    });
    let source = () => resolve(config);
    registerAutoArchive(ctx, () => source().autoArchive);
    ctx.inject(['settings'], (sctx) => {
        sctx.settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, resolve(config), {
            setSource: (current) => { source = current; },
            onChange: () => { },
        });
    });
}
