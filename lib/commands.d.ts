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
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDeps } from './value.js';
/**
 * 注册 /clear 与 /new 命令。commands 服务就绪后注册；插件卸载时先反注册
 * 命令，再等待 in-flight 创建收尾（对齐 dsh-command-compact 的 teardown 顺序）。
 */
export declare function registerSessionCommands(ctx: Context, deps: ToolDeps): void;
