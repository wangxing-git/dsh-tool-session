/**
 * dsh-tool-session 插件入口：为模型提供会话创建/重命名/归档/切换/列表工具，
 * 沙箱挂载时统一声明提权参数（fail-closed 用户审批），并通过 SSE 事件流
 * （/api/tool-session/switch-events）实现 UI 层面的会话切换。
 *
 * @module dsh-tool-session
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { SessionSandboxController } from './sandbox.js'
import { SwitchIntent, registerSwitchEvents } from './switch.js'
import { registerSessionTools } from './tools/index.js'
import { registerSessionCommands } from './commands.js'
import { registerAutoArchive, type AutoArchiveConfig } from './auto-archive.js'
import type {} from '@deepseek-ai/dsh-settings'
import type { ToolDeps } from './value.js'

export { SessionSandboxController } from './sandbox.js'
export type { SessionEscalationArgs, EscalationSchemaFields } from './sandbox.js'
export { SwitchIntent } from './switch.js'
export type { SwitchIntentEvent, SwitchFramePayload } from './switch.js'
export type { ToolDeps } from './value.js'

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-session'

/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export const inject = ['tools', 'agents', 'fs']

/** 自动归档的 schema 字段（均可缺省，由 default 填充）。 */
interface AutoArchiveSettings {
  /** 总开关，默认 false。 */
  enabled: boolean
  /** 「过期」阈值天数：最后活跃时间早于 now - maxAgeDays 天视为过期，默认 30。 */
  maxAgeDays: number
  /** 每组（工作区 / 未分组）最多保留的未归档会话数，默认 30。 */
  maxSessionsPerWorkspace: number
}

/** 插件配置。DSH 0.1.7 起字段值是 volatile 引用（Loader 注入），按需 `.get()` 取当前值。 */
export interface SessionToolConfig {
  /** 自动归档扫描配置（可选；默认关闭）。 */
  autoArchive?: Volatile<AutoArchiveSettings>
}

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
})

/** 本插件在 profile 中的条目 id（即 settings 命名空间，须与 cordis.patch.yml 的 `id:` 一致）。 */
export const SETTINGS_NAMESPACE = 'tool-session'

/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx: Context, config: SessionToolConfig): void {
  const sandbox = new SessionSandboxController(ctx)
  const switchIntent = new SwitchIntent()
  const deps: ToolDeps = {
    sessionTitle: () => ctx.get('sessionTitle') as SessionTitleService | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined,
    agentDefaultModel: () => ctx.get('agentDefaultModel') as AgentDefaultModelConfig | undefined,
    sessionProjections: () => ctx.get('sessionProjections') as SessionProjectionRegistry | undefined,
    switchIntent,
  }
  registerSessionTools(ctx, sandbox, deps)
  registerSessionCommands(ctx, deps)
  registerSwitchEvents(ctx, switchIntent)

  // 自动归档扫描：默认关闭，开启后在任何会话创建（session/created）时触发。
  // 配置读取恒经 volatile 引用（Loader 就地提交新值到同一引用），故无需缓存与变更订阅：
  // 每次判定重新求值即拿到最新配置；配置来源为 profile 条目 Config（entry id = tool-session）。
  const resolveAutoArchive = (c: SessionToolConfig): AutoArchiveConfig => {
    const autoArchive = c.autoArchive?.get()
    return {
      enabled: autoArchive?.enabled ?? false,
      maxAgeDays: autoArchive?.maxAgeDays ?? 30,
      maxSessionsPerWorkspace: autoArchive?.maxSessionsPerWorkspace ?? 30,
    }
  }
  registerAutoArchive(ctx, () => resolveAutoArchive(config))
  // 接入 DSH 设置：0.1.7 起插件不再自注册配置段（installSection 已移除），配置即本条目
  // Config 上的 volatile 字段；configure({ auto: false }, ctx.fiber) 声明自带配置页面
  // （客户端 plugins.bundle.config 槽）。owner 必须显式传 ctx.fiber：默认值是 settings
  // 服务自身的 fiber，会把页面策略挂到错误的实例上。
  ctx.inject(['settings'], (sctx) => {
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber))
  })
}
