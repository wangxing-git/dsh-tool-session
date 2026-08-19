/**
 * SessionToolRow：会话工具的专属折叠行视图。
 *
 * 通过 tool.call.toolview keyed slot 注册（见 client.ts），按 wire tool name
 * 命中本组件、替换 generic 卡片。视觉对齐 ui-tool 的通用行（图标 + 标题 +
 * 摘要 + 可展开的输入/结果段），状态用 StateDot 表达（运行/完成/失败/中止）。
 *
 * 组件是冻结调用节点（ToolCallBlock）的纯函数，不读取 Session 服务、不订阅
 * 运行时——折叠/展开仅靠本地 useState。
 *
 * @module dsh-tool-session/client/session-tool-row
 */
import { useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { IconChevronDownOutline14, IconInspectOutline12, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_PRESENTATION, SESSION_TOOL_PRESENTATIONS } from './presentations.js'

/** 折叠行展示状态（running/ok/error/stopped）。 */
type RowState = 'running' | 'ok' | 'error' | 'stopped'

/** 从冻结的调用节点推导展示状态（对齐 ui-tool / ui-skill 的状态判定）。 */
function rowState(block: ToolCallBlock): RowState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/** 解析工具调用参数 JSON；失败返回 undefined。 */
function parseArgs(argsRaw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 展平已结束调用的结果内容为文本（对齐 ui-tool 的 resultText）。 */
function resultText(block: ToolResultNode): string | null {
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n') || null
}

/** 折叠行模型：摘要 + 展开段内容。 */
interface SessionRowModel {
  state: RowState
  /** 折叠行摘要；空串表示不渲染摘要段。 */
  summary: string
  /** 展开的输入（格式化后的参数 JSON）；null 表示无输入段。 */
  input: string | null
  /** 展开的输出（结果文本）；null 表示无输出段。 */
  output: string | null
  /** 失败行的折叠摘要（首行错误）；null 表示保持 summary。 */
  errorSummary: string | null
}

/** 从冻结节点 + 呈现配置组装折叠行模型。 */
function sessionRowModel(toolName: string, block: ToolCallBlock): SessionRowModel {
  const presentation = SESSION_TOOL_PRESENTATIONS[toolName] ?? DEFAULT_PRESENTATION
  const settled = 'kind' in block
  const argsRaw = settled ? block.call?.argsRaw : block.argsRaw
  const args = argsRaw !== undefined ? parseArgs(argsRaw) : undefined
  const state = rowState(block)
  const input = args !== undefined
    ? JSON.stringify(args, null, 2)
    : argsRaw !== undefined && argsRaw !== ''
      ? argsRaw
      : null
  const output = settled ? resultText(block) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  return {
    state,
    summary: presentation.summarize(args, block.callId),
    input,
    output,
    errorSummary,
  }
}

/** 取文本首行（失败行折叠摘要只用首行）。 */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** 内联样式（CSS token 对齐 ui-tool / ui-skill 的行视觉）。 */
const styles: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', alignItems: 'center', minWidth: 0, height: 24 },
  leading: {
    width: 16,
    height: 16,
    color: 'var(--dsw-alias-label-tertiary)',
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  title: { color: 'var(--dsw-alias-label-secondary)', flex: 'none', fontSize: 14, lineHeight: '24px' },
  separator: { background: 'var(--dsw-alias-label-caption)', borderRadius: 1, width: 2, height: 2, margin: '0 8px', flex: 'none' },
  summary: {
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    color: 'var(--dsw-alias-label-tertiary)',
    // 只占内容宽度（flex-grow 0），让展开箭头紧跟摘要而非被推到行尾；
    // 超长时仍可收缩（flex-shrink 1）+ 省略号截断。
    flex: '0 1 auto',
    fontSize: 14,
    lineHeight: '24px',
    overflow: 'hidden',
  },
  errorSummary: { color: 'var(--dsw-alias-state-error-primary)' },
  chevron: { color: 'var(--dsw-alias-label-secondary)', flex: 'none', marginLeft: 8 },
  bodyWrap: { display: 'flex', flexDirection: 'column' },
  section: {
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-markdown-code-block)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    margin: '4px 0 4px 4px',
    overflow: 'hidden',
  },
  sectionHeader: {
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-markdown-code-block-banner)',
    color: 'var(--dsw-alias-label-caption)',
    textTransform: 'uppercase',
    letterSpacing: '.04em',
    flex: 'none',
    padding: '8px 12px',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '16px',
  },
  sectionBody: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    minHeight: 0,
    font: 'var(--dsw-font-markdown-code-block-small)',
    color: 'var(--dsw-alias-label-secondary)',
    margin: 0,
    padding: '10px 12px 12px',
    overflow: 'auto',
  },
  inspectButton: {
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    borderRadius: 999,
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 4,
    margin: '4px 0 2px 4px',
    padding: '2px 8px',
    fontSize: 11,
    lineHeight: '16px',
    display: 'inline-flex',
  },
}

/**
 * 渲染一个会话工具调用为专属折叠行。
 * @param props - keyed toolview 的 owner 载荷（ToolCallOwnerProps）+ 会话标准座位。
 * @returns 折叠行（可展开显示参数与结果）。
 */
export function SessionToolRow({ toolName, block, inspect }: ToolCallViewProps) {
  const presentation = SESSION_TOOL_PRESENTATIONS[toolName] ?? DEFAULT_PRESENTATION
  const model = sessionRowModel(toolName, block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.input !== null || model.output !== null
  const open = expanded && expandable
  const summary = model.errorSummary ?? model.summary
  const Icon = presentation.icon

  const toggle = (): void => {
    if (expandable) setExpanded((value) => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggle()
  }

  const rowInteraction = expandable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: toggle,
        onKeyDown: toggleFromKeyboard,
        'aria-expanded': open,
      }
    : {}

  return (
    <div style={styles.card} data-tool={toolName} data-state={model.state}>
      <div style={styles.row} data-expandable={expandable || undefined} {...rowInteraction}>
        <span style={styles.leading}>
          {model.state === 'error' ? (
            <StateDot state="error" />
          ) : model.state === 'stopped' ? (
            <StateDot state="warning" />
          ) : (
            <Icon size={14} />
          )}
        </span>
        <span style={styles.title}>{presentation.title}</span>
        {summary !== '' && (
          <>
            <span style={styles.separator} aria-hidden />
            <span style={model.errorSummary !== null ? { ...styles.summary, ...styles.errorSummary } : styles.summary}>
              {summary}
            </span>
          </>
        )}
        {expandable && (
          <span style={{ ...styles.chevron, display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined }}>
            <IconChevronDownOutline14 size={14} />
          </span>
        )}
      </div>
      {open && (
        <div style={styles.bodyWrap}>
          {model.input !== null && (
            <section style={styles.section} aria-label="输入参数">
              <div style={styles.sectionHeader}>输入</div>
              <pre style={styles.sectionBody}>{model.input}</pre>
            </section>
          )}
          {model.output !== null && (
            <section style={styles.section} aria-label="执行结果">
              <div style={styles.sectionHeader}>结果</div>
              <pre style={{ ...styles.sectionBody, color: model.state === 'error' ? 'var(--dsw-alias-state-error-primary)' : undefined }}>
                {model.output}
              </pre>
            </section>
          )}
          {inspect !== undefined && (
            <button type="button" style={styles.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      )}
    </div>
  )
}
