/**
 * dsh-tool-session 插件入口：为模型提供会话创建/重命名/归档/切换/列表工具，
 * 沙箱挂载时统一声明提权参数（fail-closed 用户审批），并通过 SSE 事件流
 * （/api/tool-session/switch-events）实现 UI 层面的会话切换。
 *
 * @module dsh-tool-session
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
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
export type { ToolDeps } from './value.js'

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-session'

/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export const inject = ['tools', 'agents', 'fs']

/** 插件配置。 */
export interface SessionToolConfig {
  /** 自动归档扫描配置（可选；默认关闭）。 */
  autoArchive?: {
    /** 总开关，默认 false。 */
    enabled?: boolean
    /** 「过期」阈值天数：最后活跃时间早于 now - maxAgeDays 天视为过期，默认 30。 */
    maxAgeDays?: number
    /** 每组（工作区 / 未分组）最多保留的未归档会话数，默认 30。 */
    maxSessionsPerWorkspace?: number
  }
}

/** 插件配置 schema（带默认值；autoArchive 默认关闭）。 */
export const Config = z.object({
  autoArchive: z.object({
    enabled: z.boolean().default(false),
    maxAgeDays: z.natural().min(1).default(30),
    maxSessionsPerWorkspace: z.natural().min(1).default(30),
  }).default({ enabled: false, maxAgeDays: 30, maxSessionsPerWorkspace: 30 }),
})

/** settings.yaml 顶层 namespace（插件短名 tool-session）。 */
export const SETTINGS_NAMESPACE = 'tool-session'

/** autoArchive 的解析后运行时形态（字段必填，由 cordis config + 默认兜底）。 */
interface ResolvedSessionConfig {
  autoArchive: AutoArchiveConfig
}

/** settings namespace schema：字段必填，base 层由 cordis config 解析提供。 */
const SettingsSchema = z.object({
  autoArchive: z.object({
    enabled: z.boolean().required(),
    maxAgeDays: z.natural().min(1).required(),
    maxSessionsPerWorkspace: z.natural().min(1).required(),
  }).required(),
})

/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx: Context, config: SessionToolConfig): void {
  const sandbox = new SessionSandboxController(ctx)
  const switchIntent = new SwitchIntent()
  const deps: ToolDeps = {
    sessionTitle: () => ctx.get('sessionTitle') as SessionTitleService | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined,
    agentDefaultModel: () => ctx.get('agentDefaultModel') as AgentDefaultModelConfig | undefined,
    switchIntent,
  }
  registerSessionTools(ctx, sandbox, deps)
  registerSessionCommands(ctx, deps)
  registerSwitchEvents(ctx, switchIntent)

  // 自动归档扫描：默认关闭，开启后在任何会话创建（session/created）时触发。
  // 配置优先级：settings.yaml（tool-session section，热生效）> cordis.patch.yml（base）> schema 默认。
  const resolve = (c: SessionToolConfig): ResolvedSessionConfig => ({
    autoArchive: {
      enabled: c.autoArchive?.enabled ?? false,
      maxAgeDays: c.autoArchive?.maxAgeDays ?? 30,
      maxSessionsPerWorkspace: c.autoArchive?.maxSessionsPerWorkspace ?? 30,
    },
  })
  let source = (): ResolvedSessionConfig => resolve(config)
  registerAutoArchive(ctx, () => source().autoArchive)
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, resolve(config), {
      setSource: (current: () => ResolvedSessionConfig) => { source = current },
      onChange: () => {},
    })
  })
}
