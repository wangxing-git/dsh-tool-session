/**
 * dsh-tool-session 插件入口：为模型提供会话创建/重命名/归档/切换/列表工具，
 * 沙箱挂载时统一声明提权参数（fail-closed 用户审批），并通过 /session-tool RPC
 * 通道 + client 端轮询实现 UI 层面的会话切换。
 *
 * @module dsh-tool-session
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { SessionSandboxController } from './sandbox.js'
import { SwitchIntent, registerSwitchRpc } from './switch.js'
import { registerSessionTools } from './tools/index.js'
import type { ToolDeps } from './value.js'

export { SessionSandboxController } from './sandbox.js'
export type { SessionEscalationArgs, EscalationSchemaFields } from './sandbox.js'
export { SwitchIntent } from './switch.js'
export type { ToolDeps } from './value.js'

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'tool-session'

/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export const inject = ['tools', 'agents', 'fs']

/** 插件配置（预留：后续可加 allowSwitch/allowArchive 等开关）。 */
export interface SessionToolConfig {}

/** 插件配置 schema（与 dsh-tool-fs 同款 z<Config> 标注）。 */
export const Config: z<SessionToolConfig> = z.object({})

/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export function apply(ctx: Context, _config: SessionToolConfig): void {
  const sandbox = new SessionSandboxController(ctx)
  const switchIntent = new SwitchIntent()
  const deps: ToolDeps = {
    sessionTitle: () => ctx.get('sessionTitle') as SessionTitleService | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined,
    agentDefaultModel: () => ctx.get('agentDefaultModel') as AgentDefaultModelConfig | undefined,
    switchIntent,
  }
  registerSessionTools(ctx, sandbox, deps)
  registerSwitchRpc(ctx, switchIntent)
}
