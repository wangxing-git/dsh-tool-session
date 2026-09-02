# dsh-tool-session

DeepSeek Harness 会话管理工具插件：为**模型（agent）**提供会话创建 / 重命名 / 归档 / 切换 / 列表 / 查询 / 当前会话信息工具，支持沙箱提权审批、UI 层面的会话切换、会话工具在对话流中的专属视图（各自图标 + 中文标题 + 摘要，替换默认的 generic 卡片），并为**人**提供 `/clear`、`/new` 两个斜杠命令（在输入框直接创建新会话并切换，不经模型）。

## 功能

| 工具 | 作用 |
|---|---|
| `create_session` | 创建新会话（可指定 cwd/workspace_id/title/agent_preset/switch/initial_message；workspace_id 会将新会话归属到该工作区，switch:true 创建后切换 UI，initial_message 可带首轮消息发起对话） |
| `rename_session` | 重命名会话（显式标题，钉住自动标题生成） |
| `archive_session` | 归档会话（隐藏但保留持久化日志，可恢复——本插件不提供真删除） |
| `switch_session` | 切换当前会话（UI 跟随打开目标会话） |
| `list_sessions` | 列出会话（id/title/cwd/running/archived/workspace 归属；可选 `workspace_id` 只返回指定工作区的会话，可选 `include_archived` 含归档，可选 `query` 按关键字对标题 / 会话 id / 工作目录 / 工作区标题做大小写不敏感的子串模糊搜索） |
| `get_session` | 按 id 查看单个会话详情（含 running/archived/workspace 归属） |
| `get_current_session` | 获取当前会话信息（id/cwd/title/workspace 归属） |

> 7 个工具的结果统一以**格式化 JSON 文本**返回（缩进 2 空格），模型直接读取结构化结果，而非人类可读的文本摘要。

### 斜杠命令（人类直接触发，不经 LLM）

| 命令 | 作用 |
|---|---|
| `/clear` | 在会话输入框直接创建新会话并切换过去（清空上下文），**不经过模型**——命令在 UI 命令平面执行，斜杠输入与结果文本都不进入会话历史 |
| `/new` | 与 `/clear` 同义：创建新会话并切换过去，不经过模型 |

> 两个命令都只接受无参数形式；带参数会返回 `Usage: /clear (no arguments)`。新会话继承当前会话的工作目录（cwd）与 agent preset，创建后归属 path === cwd 的工作区并切换 UI。命令依赖 `commands` 服务（`@deepseek-ai/dsh-commands`，随 dsh base 提供）；UI-less 部署不提供该服务时命令静默不注册，7 个会话工具照常可用。

## 权限

- 沙箱后端挂载时，7 个工具统一声明 `sandbox_permissions` + `justification` 提权参数（与 bash/fs 同款词汇）。
- 提权经 `approveEscalation` 走 fail-closed 用户审批：非严格更宽、无审批服务、无 agent、拒绝/取消均不执行任何会话变更。
- `archive_session` 归档属破坏性操作，除沙箱提权外另经 `approval.request` 独立用户审批：无审批服务、无 agent、被拒/取消均不归档（fail-closed）。
- 会话操作本身经 host 服务（`ctx.agents` / `ctx.sessionTitle` / `ctx.workspaceRegistry` / `ctx.agentDefaultModel`）完成，不直接碰会话持久化文件。
- `create_session` 通过 `agentOptions` 声明默认模型的 seed 路由（provider/model）；model selection 的后续切换由 host-apiproxy 的 `session.selectModel` / `session.models` 端点惰性安装的动态 ref 接管，故会话中途切换模型可即时生效。缺省模型服务时 fail-closed 拒绝创建。
- `create_session` 创建后调用 `workspace.attachSession()` 将新会话归属到工作区：显式 `workspace_id` 优先，否则默认归属 path === cwd 的工作区（通常是当前工作区）。

## 自动归档扫描（可选，默认关闭）

插件内置一个后台「自动归档扫描」：任何会话创建（UI 手动新建、`create_session` 工具、`/clear`、`/new`、fork 等）都会触发一次扫描，按规则静默归档历史会话。归档与手动 `archive_session` 同语义——隐藏但保留持久化日志、可恢复，但**不弹审批**（由配置显式开启的自动行为）。

规则（每组独立；组 = 每个工作区 + 未分组）：

- 组内未归档会话数 ≤ 上限时**不归档任何会话**（即使有超过阈值天数的会话）。
- 组内未归档会话数 > 上限时，归档到恰好 ≤ 上限；**优先归档过期会话**（最后活跃时间超过阈值天数），过期不足则继续归档最旧的未过期会话。
- 「过期」按最后活跃时间判定：`max(创建时间, 最后一条人类消息时间)`，与侧边栏会话排序语义一致。
- 只归档非运行中（cold）的历史会话；正在运行的会话与新建会话永不归档。

配置优先级：`settings.yaml` > `cordis.patch.yml`（composition base）> schema 默认。

**方式一：settings.yaml（推荐）** —— 编辑 `~/.dsh/settings.yaml`，追加 `tool-session` 段后**重启 dsh 生效**（文件手改不会热加载；UI 设置面板的改动则即时生效）：

```yaml
tool-session:
  autoArchive:
    enabled: true                 # 总开关，默认 false（关闭）
    maxAgeDays: 30                # 过期阈值天数，默认 30
    maxSessionsPerWorkspace: 30   # 每组最多保留的未归档会话数，默认 30
```

**方式二：cordis.patch.yml（composition base，需重启）** —— 编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: tool-session
  config:
    autoArchive:
      enabled: true
      maxAgeDays: 30
      maxSessionsPerWorkspace: 30
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `autoArchive.enabled` | `false` | 总开关 |
| `autoArchive.maxAgeDays` | `30` | 过期阈值（天） |
| `autoArchive.maxSessionsPerWorkspace` | `30` | 每组最多保留的未归档会话数 |

## 架构


- host 端（`src/index.ts` 等）：cordis 插件，注册 7 个工具 + 切换意图 SSE 事件端点（`src/switch.ts`，经 `connection.fetch` 注册 `/api/tool-session/switch-events` 精确路由，以 `text/event-stream` 推送）+ `/clear`、`/new` 两个斜杠命令（`src/commands.ts`，经 `ctx.commands` 注册，复用 `src/create-session.ts` 的创建核心）。
- client 端（`src/client.ts`）：订阅 SSE 事件流完成 UI 切换（连接存活期间零轮询，断线按 500ms 起指数退避重连，connection generation 变化时立即重订），并把 7 个会话工具的专属折叠行注册进 `tool.call.toolview` keyed slot（替换未注册时的 generic 卡片）。
- client 组件（`src/client/presentations.ts` + `src/client/session-tool-row.tsx`）：呈现注册表（每工具标题/图标/摘要提取）+ 折叠行组件（图标 + 标题 + 摘要，可展开参数/结果，状态用 StateDot 表达）。

## 安装到 profile

### 方式一：命令行安装（推荐）

执行：

```bash
dsh plugin --profile web add github:wangxing-git/dsh-tool-session
```

`dsh plugin add` 会在 `~/.dsh/profiles/web` 内调用 pnpm 安装依赖，并在成功后自动把声明了 `dsh.bundle` 的插件追加进 `dsh.profile.bundles`，无需手动编辑。然后重启 `dsh --profile web`。

### 方式二：手动编辑 package.json

在 `~/.dsh/profiles/web/package.json` 中：

```jsonc
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-session"] } },
  "dependencies": { "dsh-tool-session": "github:wangxing-git/dsh-tool-session" }
}
```

然后在 profile 目录执行 `pnpm install`，重启 `dsh --profile web`。

> 本地开发调试时，可用 `dsh plugin --profile web add link:/绝对路径/dsh-tool-session`，或手写 `"dsh-tool-session": "link:/绝对路径/dsh-tool-session"` 后执行 `pnpm install`（`link:` 建议用绝对路径，相对路径会相对 profile 目录解析）。

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
10. 在会话输入框输入 `/` 后，命令菜单出现 `/clear` 与 `/new`；输入 `/clear`（或 `/new`）回车后，不经模型直接创建新会话并切换过去（旧会话保留、含一条 command 生命周期记录）。
11. 新会话继承当前会话的工作目录与 agent preset，归属相同工作区，UI 侧边栏出现并切换到新会话。
12. `list_sessions` 传 `query` 关键字后仅返回标题 / 会话 id / 工作目录 / 工作区标题命中该关键字的会话（大小写不敏感，`query` 与 `workspace_id` / `include_archived` 可叠加过滤）。
