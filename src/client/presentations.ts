/**
 * 会话工具的 UI 呈现注册表：为每个 wire tool name 声明专属标题、图标与
 * 折叠行摘要提取函数。组件（session-tool-row.tsx）按 toolName 查表渲染，
 * 新增会话工具只需在此追加条目（开闭原则：注册表驱动，不侵入组件分支）。
 *
 * 本文件只依赖 primitives 图标与 react 类型，不渲染 JSX，故保持 .ts 扩展名。
 *
 * @module dsh-tool-session/client/presentations
 */
import type { ComponentType } from 'react'
import {
  IconArchiveOutline20,
  IconBranchOutline16,
  IconEditOutline16,
  IconListPenOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** 工具行前导图标的最小 props 契约（对齐 primitives 图标签名）。 */
interface ToolIconProps {
  size?: number
  className?: string
}

/** 单个会话工具的呈现配置。 */
export interface ToolPresentation {
  /** 折叠行标题（本插件固定中文文案，不接入 locale）。 */
  title: string
  /** 折叠行前导图标（以 size=14 渲染在 16px 前导框内）。 */
  icon: ComponentType<ToolIconProps>
  /** 从调用参数推导折叠行摘要；无可用参数时回退到 callId。 */
  summarize: (args: Record<string, unknown> | undefined, callId: string) => string
}

/** 取参数对象中第一个非空字符串字段（参考 ui-tool 的 pickString）。 */
function pickString(args: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (args === undefined) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** 截取首行，避免多行参数撑开折叠行。 */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** 会话 id 摘要（多数会话工具的核心参数）。 */
const summarizeSessionId = (args: Record<string, unknown> | undefined, callId: string): string =>
  pickString(args, ['session_id']) ?? callId

/** 7 个会话工具的呈现注册表（按 wire tool name 索引）。 */
export const SESSION_TOOL_PRESENTATIONS: Readonly<Record<string, ToolPresentation>> = {
  create_session: {
    title: '创建会话',
    icon: IconPlusOutline16,
    summarize: (args, callId) =>
      firstLine(pickString(args, ['title', 'initial_message', 'workspace_id']) ?? callId),
  },
  rename_session: {
    title: '重命名会话',
    icon: IconEditOutline16,
    summarize: (args, callId) =>
      pickString(args, ['title']) ?? summarizeSessionId(args, callId),
  },
  archive_session: {
    title: '归档会话',
    icon: IconArchiveOutline20,
    summarize: summarizeSessionId,
  },
  switch_session: {
    title: '切换会话',
    icon: IconBranchOutline16,
    summarize: summarizeSessionId,
  },
  list_sessions: {
    title: '列出会话',
    icon: IconListPenOutline16,
    summarize: (args) => {
      const query = pickString(args, ['query'])
      const workspace = pickString(args, ['workspace_id'])
      const raw = args?.status
      const statuses = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
      const archived = statuses.includes('archived') || statuses.includes('all')
      const parts: string[] = []
      if (query !== undefined) parts.push(`搜索「${query}」`)
      if (workspace !== undefined) parts.push(archived ? `工作区 ${workspace}（含已归档）` : `工作区 ${workspace}`)
      else if (archived) parts.push('含已归档')
      return parts.join(' · ')
    },
  },
  get_current_session: {
    title: '当前会话',
    icon: IconPanelLeftOutline16,
    summarize: () => '',
  },
  get_session: {
    title: '查询会话',
    icon: IconSearchOutline16,
    summarize: summarizeSessionId,
  },
}

/** 未收录工具名的兜底呈现（与 generic 卡片的 others 视觉对齐，避免空白行）。 */
export const DEFAULT_PRESENTATION: ToolPresentation = {
  title: '会话工具',
  icon: IconSparkle16,
  summarize: summarizeSessionId,
}
