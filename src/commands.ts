/**
 * /clear 与 /new 命令：在会话输入框直接创建新会话并切换过去，不经过 LLM。
 *
 * 命令通过 ctx.commands 注册（对齐 dsh-command-compact / dsh-command-goal 的
 * 全局命令平面），在 UI 命令平面执行：斜杠输入与结果文本都不提交给模型、
 * 不进入会话历史。handler 直接经 host 服务创建新会话（继承当前会话的 cwd 与
 * agent preset）、归属工作区，并复用 SwitchIntent + client 端轮询完成 UI 切换。
 *
 * commands 服务为可选：UI-less 部署（demo spine / ACP 自动化）不提供命令
 * 适配器，此时通过 ctx.inject(['commands'], ...) 静默等待，命令不注册、
 * 7 个会话工具照常可用（不因缺 commands 服务而拖垮整个插件）。
 *
 * @module dsh-tool-session/commands
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createSession } from './create-session.js'
import type { ToolDeps } from './value.js'

/** /clear、/new 的 no-arguments 用法提示（对齐 /compact 语义）。 */
const USAGE = 'Usage: /clear (no arguments)'

/**
 * 执行一次「新建会话并切换」：继承当前会话的 cwd 与 agent preset，
 * 创建新会话、归属 path===cwd 的工作区，并请求 UI 切换到新会话。
 */
async function executeNewSession(ctx: Context, deps: ToolDeps, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  if (invocation.signal.aborted) {
    return { kind: 'error', text: 'New session cancelled.' }
  }
  const session = invocation.agent.session
  const cwd = session.header.cwd
  if (cwd === undefined) {
    return { kind: 'error', text: 'Cannot start a new session: the current session has no working directory.' }
  }
  try {
    // 继承当前会话「实际运行」的 preset（含创建后的 agent-preset/selected 事件），
    // rosterless 部署时为 undefined，新会话保持不挂 preset。
    const presetId = resolveSessionPreset(session)
    const registry = deps.workspaceRegistry()
    const workspace = registry === undefined ? undefined : registry.list().find((ws) => ws.path === cwd)
    const { sessionId } = await createSession(ctx, deps, {
      cwd,
      workspace,
      ...(presetId !== undefined ? { presetId } : {}),
      switch: true,
    })
    return { kind: 'success', text: `Started a new session: ${String(sessionId)}` }
  } catch (error) {
    if (invocation.signal.aborted) {
      return { kind: 'error', text: 'New session cancelled.' }
    }
    throw error
  }
}

/**
 * 注册 /clear 与 /new 命令。commands 服务就绪后注册；插件卸载时先反注册
 * 命令，再等待 in-flight 创建收尾（对齐 dsh-command-compact 的 teardown 顺序）。
 */
export function registerSessionCommands(ctx: Context, deps: ToolDeps): void {
  ctx.inject(['commands'], (cmdCtx) => {
    const commands = cmdCtx.commands
    const active = new Set<Promise<CommandResult>>()
    const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
      const operation = executeNewSession(ctx, deps, invocation)
      active.add(operation)
      const retire = (): void => { active.delete(operation) }
      operation.then(retire, retire)
      return operation
    }
    cmdCtx.effect(function* () {
      yield async () => { await Promise.allSettled(active) }
      yield commands.register({
        name: 'clear',
        description: 'Start a new session (clears context) and switch to it',
        handler,
      })
      yield commands.register({
        name: 'new',
        description: 'Create a new session and switch to it',
        handler,
      })
    }, 'tool-session: clear/new commands')
  })
}
