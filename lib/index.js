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
/**
 * 插件配置 schema（带默认值；autoArchive 默认关闭）。
 *
 * DSH 0.1.7 起只有标注 `.volatile()` 的字段会进入插件配置表单（未标注的字段既不显示、
 * 写入也会被 `Config field "x" is not volatile` 拒绝），故 autoArchive 整体标 volatile——
 * volatile 必须落在有固定对象路径的字段上，不能标在嵌套字段内部。
 */
export const Config = z.object({
    autoArchive: z.object({
        enabled: z.boolean().default(false),
        maxAgeDays: z.natural().min(1).default(30),
        maxSessionsPerWorkspace: z.natural().min(1).default(30),
    }).default({ enabled: false, maxAgeDays: 30, maxSessionsPerWorkspace: 30 }).volatile(),
});
/** 本插件在 profile 中的条目 id（即 settings 命名空间，须与 cordis.patch.yml 的 `id:` 一致）。 */
export const SETTINGS_NAMESPACE = 'tool-session';
/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx, config) {
    const sandbox = new SessionSandboxController(ctx);
    const switchIntent = new SwitchIntent();
    const deps = {
        sessionTitle: () => ctx.get('sessionTitle'),
        workspaceRegistry: () => ctx.get('workspaceRegistry'),
        agentDefaultModel: () => ctx.get('agentDefaultModel'),
        sessionProjections: () => ctx.get('sessionProjections'),
        switchIntent,
    };
    registerSessionTools(ctx, sandbox, deps);
    registerSessionCommands(ctx, deps);
    registerSwitchEvents(ctx, switchIntent);
    // 自动归档扫描：默认关闭，开启后在任何会话创建（session/created）时触发。
    // 配置读取恒经 volatile 引用（Loader 就地提交新值到同一引用），故无需缓存与变更订阅：
    // 每次判定重新求值即拿到最新配置；配置来源为 profile 条目 Config（entry id = tool-session）。
    const resolveAutoArchive = (c) => {
        const autoArchive = c.autoArchive?.get();
        return {
            enabled: autoArchive?.enabled ?? false,
            maxAgeDays: autoArchive?.maxAgeDays ?? 30,
            maxSessionsPerWorkspace: autoArchive?.maxSessionsPerWorkspace ?? 30,
        };
    };
    registerAutoArchive(ctx, () => resolveAutoArchive(config));
    // 接入 DSH 设置：0.1.7 起插件不再自注册配置段（installSection 已移除），配置即本条目
    // Config 上的 volatile 字段；configure({ auto: false }, ctx.fiber) 声明自带配置页面
    // （客户端 plugins.bundle.config 槽）。owner 必须显式传 ctx.fiber：默认值是 settings
    // 服务自身的 fiber，会把页面策略挂到错误的实例上。
    ctx.inject(['settings'], (sctx) => {
        sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber));
    });
}
