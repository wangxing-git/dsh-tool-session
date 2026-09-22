window.__ModuleLoader__.load({ id: 'dsh-tool-session', factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/client/session-tool-row.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/presentations.ts
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
function pickString(args, keys) {
  if (args === void 0) return void 0;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return void 0;
}
function firstLine(text) {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}
var summarizeSessionId = (args, callId) => pickString(args, ["session_id"]) ?? callId;
var SESSION_TOOL_PRESENTATIONS = {
  create_session: {
    title: "\u521B\u5EFA\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconPlusOutlineMedium,
    summarize: (args, callId) => firstLine(pickString(args, ["title", "initial_message", "workspace_id"]) ?? callId)
  },
  rename_session: {
    title: "\u91CD\u547D\u540D\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconEditOutlineMedium,
    summarize: (args, callId) => pickString(args, ["title"]) ?? summarizeSessionId(args, callId)
  },
  archive_session: {
    title: "\u5F52\u6863\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconArchiveOutlineMedium,
    summarize: summarizeSessionId
  },
  switch_session: {
    title: "\u5207\u6362\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconBranchOutlineMedium,
    summarize: summarizeSessionId
  },
  list_sessions: {
    title: "\u5217\u51FA\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconListPenOutlineMedium,
    summarize: (args) => {
      const query = pickString(args, ["query"]);
      const workspace = pickString(args, ["workspace_id"]);
      const raw = args?.status;
      const statuses = Array.isArray(raw) ? raw : raw === void 0 ? [] : [raw];
      const archived = statuses.includes("archived") || statuses.includes("all");
      const parts = [];
      if (query !== void 0) parts.push(`\u641C\u7D22\u300C${query}\u300D`);
      if (workspace !== void 0) parts.push(archived ? `\u5DE5\u4F5C\u533A ${workspace}\uFF08\u542B\u5DF2\u5F52\u6863\uFF09` : `\u5DE5\u4F5C\u533A ${workspace}`);
      else if (archived) parts.push("\u542B\u5DF2\u5F52\u6863");
      return parts.join(" \xB7 ");
    }
  },
  get_current_session: {
    title: "\u5F53\u524D\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconPanelLeftOutlineMedium,
    summarize: () => ""
  },
  get_session: {
    title: "\u67E5\u8BE2\u4F1A\u8BDD",
    icon: import_dsh_client_ui_primitives.IconSearchOutlineMedium,
    summarize: summarizeSessionId
  }
};
var DEFAULT_PRESENTATION = {
  title: "\u4F1A\u8BDD\u5DE5\u5177",
  icon: import_dsh_client_ui_primitives.IconSparkleMedium,
  summarize: summarizeSessionId
};

// src/client/session-tool-row.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function rowState(block) {
  if (!("kind" in block)) return "running";
  if (block.error?.code === "interrupted") return "stopped";
  return block.isError ? "error" : "ok";
}
function parseArgs(argsRaw) {
  try {
    const parsed = JSON.parse(argsRaw);
    return typeof parsed === "object" && parsed !== null ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function resultText(block) {
  const parts = [];
  for (const item of block.content) {
    parts.push(item.type === "text" ? item.text : JSON.stringify(item, null, 2));
  }
  if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
  return parts.join("\n") || null;
}
function sessionRowModel(toolName, block) {
  const presentation = SESSION_TOOL_PRESENTATIONS[toolName] ?? DEFAULT_PRESENTATION;
  const settled = "kind" in block;
  const argsRaw = settled ? block.call?.argsRaw : block.argsRaw;
  const args = argsRaw !== void 0 ? parseArgs(argsRaw) : void 0;
  const state = rowState(block);
  const input = args !== void 0 ? JSON.stringify(args, null, 2) : argsRaw !== void 0 && argsRaw !== "" ? argsRaw : null;
  const output = settled ? resultText(block) : null;
  const errorSummary = state === "error" && output !== null ? firstLine2(output) : null;
  return {
    state,
    summary: presentation.summarize(args, block.callId),
    input,
    output,
    errorSummary
  };
}
function firstLine2(text) {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}
var styles = {
  card: { display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", minWidth: 0, height: 24 },
  leading: {
    width: 16,
    height: 16,
    color: "var(--dsw-alias-label-tertiary)",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6
  },
  title: { color: "var(--dsw-alias-label-secondary)", flex: "none", fontSize: 14, lineHeight: "24px" },
  separator: { background: "var(--dsw-alias-label-caption)", borderRadius: 1, width: 2, height: 2, margin: "0 8px", flex: "none" },
  summary: {
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    color: "var(--dsw-alias-label-tertiary)",
    // 只占内容宽度（flex-grow 0），让展开箭头紧跟摘要而非被推到行尾；
    // 超长时仍可收缩（flex-shrink 1）+ 省略号截断。
    flex: "0 1 auto",
    fontSize: 14,
    lineHeight: "24px",
    overflow: "hidden"
  },
  errorSummary: { color: "var(--dsw-alias-state-error-primary)" },
  chevron: { color: "var(--dsw-alias-label-secondary)", flex: "none", marginLeft: 8 },
  bodyWrap: { display: "flex", flexDirection: "column" },
  section: {
    border: "1px solid var(--dsw-alias-border-l1)",
    background: "var(--dsw-alias-markdown-code-block)",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    margin: "4px 0 4px 4px",
    overflow: "hidden"
  },
  sectionHeader: {
    borderBottom: "1px solid var(--dsw-alias-border-l2)",
    background: "var(--dsw-alias-markdown-code-block-banner)",
    color: "var(--dsw-alias-label-caption)",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    flex: "none",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 500,
    lineHeight: "16px"
  },
  sectionBody: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    minHeight: 0,
    font: "var(--dsw-font-markdown-code-block-small)",
    color: "var(--dsw-alias-label-secondary)",
    margin: 0,
    padding: "10px 12px 12px",
    overflow: "auto"
  },
  inspectButton: {
    border: "1px solid var(--dsw-alias-border-l2)",
    background: "var(--dsw-alias-bg-base)",
    color: "var(--dsw-alias-label-secondary)",
    cursor: "pointer",
    borderRadius: 999,
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 4,
    margin: "4px 0 2px 4px",
    padding: "2px 8px",
    fontSize: 11,
    lineHeight: "16px",
    display: "inline-flex"
  }
};
function SessionToolRow({ toolName, block, inspect }) {
  const presentation = SESSION_TOOL_PRESENTATIONS[toolName] ?? DEFAULT_PRESENTATION;
  const model = sessionRowModel(toolName, block);
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const expandable = model.input !== null || model.output !== null;
  const open = expanded && expandable;
  const summary = model.errorSummary ?? model.summary;
  const Icon = presentation.icon;
  const toggle = () => {
    if (expandable) setExpanded((value) => !value);
  };
  const toggleFromKeyboard = (event) => {
    if (!expandable || event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  };
  const rowInteraction = expandable ? {
    role: "button",
    tabIndex: 0,
    onClick: toggle,
    onKeyDown: toggleFromKeyboard,
    "aria-expanded": open
  } : {};
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.card, "data-tool": toolName, "data-state": model.state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, "data-expandable": expandable || void 0, ...rowInteraction, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.leading, children: model.state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "error" }) : model.state === "stopped" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "warning" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { size: 14 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.title, children: presentation.title }),
      summary !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.separator, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: model.errorSummary !== null ? { ...styles.summary, ...styles.errorSummary } : styles.summary, children: summary })
      ] }),
      expandable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.chevron, display: "inline-flex", transform: open ? "rotate(180deg)" : void 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutlineMedium, { size: 14 }) })
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.bodyWrap, children: [
      model.input !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.section, "aria-label": "\u8F93\u5165\u53C2\u6570", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.sectionHeader, children: "\u8F93\u5165" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: styles.sectionBody, children: model.input })
      ] }),
      model.output !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.section, "aria-label": "\u6267\u884C\u7ED3\u679C", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.sectionHeader, children: "\u7ED3\u679C" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: { ...styles.sectionBody, color: model.state === "error" ? "var(--dsw-alias-state-error-primary)" : void 0 }, children: model.output })
      ] }),
      inspect !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: styles.inspectButton, onClick: inspect, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconInspectOutlineMedium, {}),
        "Inspect"
      ] })
    ] })
  ] });
}

// src/client/switch-consumer.ts
var DEFAULT_WINDOW_MS = 4e3;
var DEFAULT_INTERVAL_MS = 120;
var SwitchConsumer = class {
  open;
  subscribeList;
  now;
  schedule;
  cancel;
  warn;
  windowMs;
  intervalMs;
  /** 最新待落地的目标；undefined 表示当前没有待处理意图。 */
  pending = void 0;
  /** 当前 pending 的重试截止时刻（毫秒时间戳）。 */
  deadline = 0;
  /** 定时兜底句柄；undefined 表示未挂起。 */
  timer = void 0;
  /** 会话列表订阅退订函数；undefined 表示未订阅。 */
  unsubscribe = void 0;
  /**
   * 重入守卫：open() 成功会同步 flush 列表通知、订阅注册也可能同步回调，
   * 两条路径都会在本次尝试尚未收尾时重入 attempt()，故直接忽略重入调用。
   */
  attempting = false;
  /**
   * @param deps - 打开方式、列表订阅与可注入的时间源 / 定时器 / 告警。
   */
  constructor(deps) {
    this.open = deps.open;
    this.subscribeList = deps.subscribeList;
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.schedule ?? ((listener, ms) => setTimeout(listener, ms));
    this.cancel = deps.cancel ?? ((timer) => {
      clearTimeout(timer);
    });
    this.warn = deps.warn ?? ((message, detail) => {
      console.warn(message, detail);
    });
    this.windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  }
  /**
   * 消费一次切换意图，并立即尝试落地。
   * 覆盖式：新的目标取代尚未落地的旧目标（与 host 端「只保留最新意图」一致）。
   * @param sessionId - 目标会话 id（调用方保证非空）。
   */
  consume(sessionId) {
    this.pending = sessionId;
    this.deadline = this.now() + this.windowMs;
    this.attempt();
  }
  /** 释放：丢弃待处理意图，清定时器并退订列表（插件卸载时调用）。 */
  dispose() {
    this.pending = void 0;
    this.clearTimer();
    this.clearSubscription();
  }
  /**
   * 尝试落地当前意图。成功即收尾；失败则挂上列表订阅与定时兜底继续等，
   * 直到成功、窗口耗尽（告警）或释放。open 抛错是预期路径，不向外传播——
   * 否则会被 SSE 帧处理的 catch 静默吞掉，正是本类要消除的失效形态。
   */
  attempt() {
    if (this.attempting) return;
    this.attempting = true;
    try {
      this.settle();
    } finally {
      this.attempting = false;
    }
  }
  /** attempt() 的实际内容：与重入守卫分离，保证守卫的 finally 一定收尾。 */
  settle() {
    this.clearTimer();
    const target = this.pending;
    if (target === void 0) return;
    this.pending = void 0;
    try {
      this.open(target);
    } catch (error) {
      if (this.now() >= this.deadline) {
        this.clearSubscription();
        this.warn(`tool-session: switch intent dropped, session never listed: ${target}`, error);
        return;
      }
      if (this.pending === void 0) this.pending = target;
      this.watch();
      return;
    }
    this.clearSubscription();
  }
  /** 挂上列表订阅（即时触发）与定时兜底（保底节奏）；重复调用幂等。 */
  watch() {
    this.unsubscribe ??= this.subscribeList(() => {
      this.attempt();
    });
    this.timer ??= this.schedule(() => {
      this.timer = void 0;
      this.attempt();
    }, this.intervalMs);
  }
  /** 清掉挂起的定时兜底。 */
  clearTimer() {
    if (this.timer === void 0) return;
    this.cancel(this.timer);
    this.timer = void 0;
  }
  /** 退订会话列表。 */
  clearSubscription() {
    this.unsubscribe?.();
    this.unsubscribe = void 0;
  }
};

// src/client/switch-frame-gate.ts
var SwitchFrameGate = class {
  /** 已放行的最大 revision；0 表示尚未放行任何带序号的帧。 */
  last = 0;
  /**
   * 判定一帧意图是否应落地。
   * @param revision - host 端埋入的意图序号；undefined 表示旧版 host 帧。
   * @returns true 表示首次见到（应消费），false 表示重复/陈旧/非法（应丢弃）。
   */
  accept(revision) {
    if (revision === void 0) return true;
    if (!Number.isSafeInteger(revision) || revision <= 0) return false;
    if (revision <= this.last) return false;
    this.last = revision;
    return true;
  }
};

// src/client.ts
var SWITCH_EVENTS_PATH = "/api/tool-session/switch-events";
var RETRY_BASE_MS = 500;
var RETRY_MAX_MS = 1e4;
var inject = ["uiWorkspace", "sessions", "connection", "slots"];
function apply(ctx) {
  ctx.slots.inject(
    "tool.call.toolview",
    () => Object.keys(SESSION_TOOL_PRESENTATIONS).map(
      (name) => ctx.slots.register({ name: "tool.call.toolview", key: name }, SessionToolRow)
    )
  );
  const connection = ctx.connection;
  if (connection === void 0) return;
  const navigation = ctx.uiWorkspace;
  if (navigation === void 0) return;
  const consumer = new SwitchConsumer({
    open: (sessionId) => {
      navigation.openSession(sessionId);
    },
    subscribeList: (listener) => {
      const dispose = ctx.sessions.list?.subscribe?.(listener);
      return typeof dispose === "function" ? dispose : () => {
      };
    }
  });
  const gate = new SwitchFrameGate();
  const processFrame = (raw) => {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.type !== "tool-session/switch-intent" || payload.sessionId === "") continue;
        if (!gate.accept(payload.revision)) continue;
        consumer.consume(payload.sessionId);
      } catch (_error) {
      }
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let disposed = false;
  let retryDelay = RETRY_BASE_MS;
  let active;
  const loop = async () => {
    while (!disposed) {
      const controller = new AbortController();
      active = controller;
      try {
        const response = await fetch(SWITCH_EVENTS_PATH, { signal: controller.signal });
        if (!response.ok || response.body === null) throw new Error("switch events: HTTP " + response.status);
        retryDelay = RETRY_BASE_MS;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!disposed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let separator;
          while ((separator = buffer.indexOf("\n\n")) !== -1) {
            processFrame(buffer.slice(0, separator));
            buffer = buffer.slice(separator + 2);
          }
        }
      } catch (_error) {
      } finally {
        if (active === controller) active = void 0;
      }
      if (disposed) break;
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }
  };
  const resetOnGeneration = connection.generation?.subscribe?.(() => {
    retryDelay = RETRY_BASE_MS;
    active?.abort();
  });
  void loop();
  ctx.effect(() => () => {
    disposed = true;
    resetOnGeneration?.();
    active?.abort();
    consumer.dispose();
  }, "tool-session: switch events subscription");
}
return module.exports; } });
