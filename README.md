# dsh-tool-session

DeepSeek Harness 会话管理工具插件：为**模型（agent）**提供会话创建 / 重命名 / 归档 / 切换 / 列表 / 查询 / 当前会话信息工具，支持沙箱提权审批、UI 层面的会话切换，以及会话工具在对话流中的专属视图（各自图标 + 中文标题 + 摘要，替换默认的 generic 卡片）。

## 功能

| 工具 | 作用 |
|---|---|
| `create_session` | 创建新会话（可指定 cwd/workspace_id/title/agent_preset/initial_message；workspace_id 会将新会话归属到该工作区，创建后可切换、可带首轮消息发起对话） |
| `rename_session` | 重命名会话（显式标题，钉住自动标题生成） |
| `archive_session` | 归档会话（隐藏但保留持久化日志，可恢复——本插件不提供真删除） |
| `switch_session` | 切换当前会话（UI 跟随打开目标会话） |
| `list_sessions` | 列出会话（id/title/cwd/running/archived/workspace 归属；可选 `workspace_id` 只返回指定工作区的会话，可选 `include_archived` 含归档） |
| `get_session` | 按 id 查看单个会话详情（含 running/archived/workspace 归属） |
| `get_current_session` | 获取当前会话信息（id/cwd/title/workspace 归属） |

> 7 个工具的结果统一以**格式化 JSON 文本**返回（缩进 2 空格），模型直接读取结构化结果，而非人类可读的文本摘要。

## 权限

- 沙箱后端挂载时，7 个工具统一声明 `sandbox_permissions` + `justification` 提权参数（与 bash/fs 同款词汇）。
- 提权经 `approveEscalation` 走 fail-closed 用户审批：非严格更宽、无审批服务、无 agent、拒绝/取消均不执行任何会话变更。
- 会话操作本身经 host 服务（`ctx.agents` / `ctx.sessionTitle` / `ctx.workspaceRegistry` / `ctx.agentDefaultModel`）完成，不直接碰会话持久化文件。
- `create_session` 通过 `setup` 安装 model selection（注入 provider/model prompt 变量并路由请求），缺省模型服务时 fail-closed 拒绝创建。
- `create_session` 创建后调用 `workspace.attachSession()` 将新会话归属到工作区：显式 `workspace_id` 优先，否则默认归属 path === cwd 的工作区（通常是当前工作区）。

## 架构

- host 端（`src/index.ts` 等）：cordis 插件，注册 7 个工具 + `/session-tool` 切换意图 RPC 端点。
- client 端（`src/client.ts`）：轮询 `switch/poll` 端点完成 UI 切换，并把 7 个会话工具的专属折叠行注册进 `tool.call.toolview` keyed slot（替换未注册时的 generic 卡片）。
- client 组件（`src/client/presentations.ts` + `src/client/session-tool-row.tsx`）：呈现注册表（每工具标题/图标/摘要提取）+ 折叠行组件（图标 + 标题 + 摘要，可展开参数/结果，状态用 StateDot 表达）。

## 安装到 profile

在 `~/.dsh/profiles/web/package.json` 中：

```jsonc
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-session"] } },
  "dependencies": { "dsh-tool-session": "link:/Users/wangxing/code/dsh-tool-session" }
}
```

然后在 profile 目录执行 `pnpm install`，重启 `dsh --profile web`。

## 构建与测试

```bash
npm install        # 安装依赖
npm run build      # tsc(host) + tsc(client) + esbuild(client bundle)
npm test           # vitest 单元测试
```

## 验证

1. 重启 `dsh --profile web` 后，模型工具目录中出现 `create_session` / `rename_session` / `archive_session` / `switch_session` / `list_sessions` / `get_session` / `get_current_session`。
2. 沙箱环境下调用任一工具带 `sandbox_permissions` 会触发审批弹窗。
3. `switch_session`（或 `create_session` + `switch:true`）执行后，UI 侧边栏当前会话切换为目标会话。
4. `archive_session` 归档后 `~/.dsh/sessions` 下文件仍在（`archivedSessionIds` 更新）。
5. `create_session` 带 `initial_message` 参数创建后，新会话立即以该消息作为首轮用户消息开始对话（`followup` 注入并唤醒 driver）。
6. `create_session` 创建后新会话归属到工作区（显式 `workspace_id` 或默认 path===cwd 的工作区），UI 侧边栏可见。
7. `get_current_session` 返回当前会话的 id/cwd/title/workspace 归属。
8. `get_session` 按 session_id 返回单个会话详情（含 running/archived/workspace 归属）。
9. 会话工具调用在对话流中显示专属视图：各自图标 + 中文标题 + 摘要，可点击展开参数/结果（不再统一显示 generic "Tool call"）。
