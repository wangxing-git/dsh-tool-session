import { defineTool } from '@deepseek-ai/dsh-tools';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import { randomUUID } from 'node:crypto';
import { SessionSandboxController } from './sandbox.js';
/** 生成新会话 id（与 DSH 持久化目录 session-<uuid> 对齐）。 */
function newSessionId() {
    return SessionId('session-' + randomUUID());
}
/** 会话是否可寻址（live 或 workspace 索引或已归档）；仅用于 switch 的存在性校验。 */
function sessionExists(sid, ctx, deps) {
    if (ctx.agents.get(sid) !== undefined)
        return true;
    const registry = deps.workspaceRegistry();
    if (registry === undefined)
        return false;
    const key = String(sid);
    if (registry.archivedSessionIds.some((id) => String(id) === key))
        return true;
    for (const workspace of registry.list()) {
        if (workspace.sessionIds.some((id) => String(id) === key))
            return true;
    }
    return false;
}
/**
 * 解析 session_create 的目标：cwd 优先，其次 workspace_id → path，最后回退当前会话 cwd。
 * 工作区归属：显式 workspace_id 优先，否则默认匹配 path === cwd 的工作区（通常是当前工作区）。
 */
function resolveCreateTarget(args, exec, deps) {
    const registry = deps.workspaceRegistry();
    let cwd;
    let workspace;
    if (args.cwd !== undefined && args.cwd.trim() !== '') {
        cwd = args.cwd;
    }
    else if (args.workspace_id !== undefined && args.workspace_id !== '') {
        if (registry === undefined)
            throw new Error('workspace-unavailable: cannot resolve workspace_id');
        workspace = registry.get(WorkspaceId(args.workspace_id));
        if (workspace === undefined)
            throw new Error(`workspace not found: ${args.workspace_id}`);
        cwd = workspace.path;
    }
    else {
        const inherited = exec.agent?.session.header.cwd;
        if (inherited === undefined)
            throw new Error('cwd is required: provide cwd or workspace_id, or create from a session that has a cwd');
        cwd = inherited;
    }
    // 默认归属：未显式指定 workspace_id 时，回退到 path === cwd 的工作区。
    if (workspace === undefined && registry !== undefined) {
        workspace = registry.list().find((ws) => ws.path === cwd);
    }
    return { cwd, workspace };
}
/** 注册 session_create 工具。 */
function applyCreateTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'session_create',
        description: 'Create a new session in a workspace directory. Optionally set its title, start a first turn with an initial user message, and switch the UI to it.',
        parameters: {
            cwd: { type: 'string', description: 'Working directory for the new session. Defaults to the calling session cwd.' },
            workspace_id: { type: 'string', description: 'Workspace id to attach the new session to. Defaults to the workspace whose path matches the resolved cwd (usually the current workspace).' },
            title: { type: 'string', description: 'Initial title for the new session (explicit rename).' },
            agent_preset: { type: 'string', description: 'Agent preset the new session agent is composed from.' },
            switch: { type: 'boolean', description: 'When true, switch the UI to the new session after creation. Defaults to false.' },
            initial_message: { type: 'string', description: 'Optional first user message: start a first turn on the new session right after creation.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    cwd: { type: 'string', required: true },
                    agent_preset: { type: 'string' },
                    title: { type: 'string' },
                },
            },
            render: (args, value) => [{ type: 'text', text: `已创建会话 ${value.session_id}（cwd: ${value.cwd}）${args.initial_message !== undefined && args.initial_message.trim() !== '' ? '，已发起首轮对话' : ''}` }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('session_create', args, exec);
            const { cwd, workspace } = resolveCreateTarget(args, exec, deps);
            const sessionId = newSessionId();
            const handle = await ctx.agents.create({
                sessionId,
                meta: {
                    cwd,
                    ...(args.agent_preset !== undefined && args.agent_preset !== '' ? { agentPreset: args.agent_preset } : {}),
                },
                setup: (agentCtx) => {
                    // 安装 model selection：注入 provider/model prompt 变量并路由请求（对齐 host-apiproxy 的 Web agent 创建路径）。
                    const defaultModel = deps.agentDefaultModel();
                    if (defaultModel === undefined)
                        throw new Error('agent-default-model-unavailable: cannot install model selection for the new session');
                    installModelSelection(agentCtx, {
                        current: defaultModel.currentSelection(),
                        assembled: undefined,
                    });
                },
            });
            if (workspace !== undefined) {
                await workspace.attachSession(sessionId);
            }
            let title;
            if (args.title !== undefined && args.title.trim() !== '') {
                const sessionTitle = deps.sessionTitle();
                if (sessionTitle === undefined)
                    throw new Error('session-title-unavailable: cannot set title');
                title = sessionTitle.rename(handle.agent.session, args.title).title;
            }
            if (args.initial_message !== undefined && args.initial_message.trim() !== '') {
                handle.agent.followup(createUserMessage({
                    content: [{ type: 'text', text: args.initial_message }],
                    source: { kind: 'user' },
                }));
            }
            if (args.switch === true)
                deps.switchIntent.request(String(sessionId));
            return {
                session_id: String(sessionId),
                cwd,
                ...(args.agent_preset !== undefined && args.agent_preset !== '' ? { agent_preset: args.agent_preset } : {}),
                ...(title !== undefined ? { title } : {}),
            };
        },
        presentCall(args) {
            return { card: 'generic', title: `创建会话${args.cwd !== undefined ? '（' + args.cwd + '）' : ''}` };
        },
    }));
}
/** 注册 session_rename 工具。 */
function applyRenameTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'session_rename',
        description: 'Rename a session by setting its explicit title (pins against automatic title generation).',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to rename.' },
            title: { type: 'string', required: true, description: 'New title; must normalize to a non-empty text.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    seq: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `会话 ${value.session_id} 已重命名为「${value.title}」` }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('session_rename', args, exec);
            const sessionId = SessionId(args.session_id);
            const agent = ctx.agents.get(sessionId);
            if (agent === undefined) {
                throw new Error(`cannot rename session ${args.session_id}: not loaded — open or switch to it first`);
            }
            const sessionTitle = deps.sessionTitle();
            if (sessionTitle === undefined)
                throw new Error('session-title-unavailable: cannot rename');
            const snapshot = sessionTitle.rename(agent.session, args.title);
            return { session_id: args.session_id, title: snapshot.title, seq: snapshot.eventSeq };
        },
        presentCall(args) {
            return { card: 'generic', title: `重命名会话 ${args.session_id}` };
        },
    }));
}
/**
 * 归档审批：归档是破坏性操作（把会话从列表隐藏），默认必须经用户审批，批准后才执行。
 * 无审批服务或无 agent 时 fail-closed 拒绝；审批被拒/取消/不可答均不归档。
 */
async function requestArchiveApproval(ctx, sessionId, exec) {
    const approval = ctx.get('approval');
    if (approval === undefined) {
        throw new Error('archive requires approval, but no approval service is mounted');
    }
    if (exec.agent === undefined) {
        throw new Error('archive requires approval, but the call has no agent to route it through');
    }
    const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'session_archive',
        callId: exec.callId,
        reason: `归档会话 ${sessionId}：从会话列表隐藏（持久化日志保留、可恢复）`,
        signal: exec.signal,
    });
    if (outcome !== 'allowed-once') {
        throw new Error(`archive not approved: ${outcome}`);
    }
}
/** 注册 session_archive 工具（删除需求的归档替代：文件保留、可恢复）。 */
function applyArchiveTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'session_archive',
        description: 'Archive a session: hide it from session lists while keeping its durable log (recoverable).',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to archive.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    archived: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `会话 ${value.session_id} 已归档` }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('session_archive', args, exec);
            const currentId = exec.agent?.session.header.id;
            if (currentId !== undefined && String(currentId) === args.session_id) {
                throw new Error('cannot archive the active session: the session this agent is running in');
            }
            // 归档默认需要审批（破坏性操作）：批准后才执行。
            await requestArchiveApproval(ctx, args.session_id, exec);
            const registry = deps.workspaceRegistry();
            if (registry === undefined)
                throw new Error('workspace-unavailable: cannot archive');
            await registry.archiveSession(SessionId(args.session_id));
            return { session_id: args.session_id, archived: true };
        },
        presentCall(args) {
            return { card: 'generic', title: `归档会话 ${args.session_id}` };
        },
    }));
}
/** 注册 session_switch 工具。 */
function applySwitchTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'session_switch',
        description: 'Switch the UI to a target session. Idempotent when already the current session.',
        parameters: {
            session_id: { type: 'string', required: true, description: 'Session id to switch the UI to.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    switched: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `已切换到会话 ${value.session_id}` }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('session_switch', args, exec);
            const currentId = exec.agent?.session.header.id;
            if (currentId !== undefined && String(currentId) === args.session_id) {
                return { session_id: args.session_id, switched: true };
            }
            const sessionId = SessionId(args.session_id);
            if (!sessionExists(sessionId, ctx, deps)) {
                throw new Error(`session not found: ${args.session_id}`);
            }
            deps.switchIntent.request(args.session_id);
            return { session_id: args.session_id, switched: true };
        },
        presentCall(args) {
            return { card: 'generic', title: `切换会话 ${args.session_id}` };
        },
    }));
}
/** 注册 session_list 工具。 */
function applyListTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'session_list',
        description: 'List sessions with id, title, cwd, running and archived flags. Archived sessions are hidden unless include_archived is true.',
        parameters: {
            include_archived: { type: 'boolean', description: 'Include archived sessions. Defaults to false.' },
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sessions: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                session_id: { type: 'string', required: true },
                                title: { type: 'string' },
                                cwd: { type: 'string' },
                                running: { type: 'boolean', required: true },
                                archived: { type: 'boolean', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const lines = value.sessions.map((s) => `- ${s.session_id}${s.title !== undefined ? '（' + s.title + '）' : ''}${s.archived ? ' [归档]' : ''}${s.running ? ' [运行中]' : ''}`);
                return [{ type: 'text', text: lines.length === 0 ? '（无会话）' : lines.join('\n') }];
            },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('session_list', args, exec);
            const registry = deps.workspaceRegistry();
            const sessionTitle = deps.sessionTitle();
            const live = new Map(ctx.agents.list().map((agent) => [String(agent.id), agent]));
            const rows = new Map();
            if (registry !== undefined) {
                for (const workspace of registry.list()) {
                    for (const sid of workspace.sessionIds) {
                        const key = String(sid);
                        rows.set(key, {
                            session_id: key,
                            cwd: live.get(key)?.session.header.cwd ?? workspace.path,
                            running: live.has(key),
                            archived: false,
                        });
                    }
                }
                for (const sid of registry.archivedSessionIds) {
                    const key = String(sid);
                    const agent = live.get(key);
                    rows.set(key, {
                        session_id: key,
                        ...(agent !== undefined ? { cwd: agent.session.header.cwd } : {}),
                        running: live.has(key),
                        archived: true,
                    });
                }
            }
            // 补充 live 但未归属任何 workspace 的会话（孤儿会话）。
            for (const agent of ctx.agents.list()) {
                const key = String(agent.id);
                if (!rows.has(key)) {
                    rows.set(key, { session_id: key, cwd: agent.session.header.cwd, running: true, archived: false });
                }
            }
            const includeArchived = args.include_archived === true;
            const items = [...rows.values()]
                .filter((row) => includeArchived || !row.archived)
                .map((row) => {
                const agent = live.get(row.session_id);
                const title = agent !== undefined && sessionTitle !== undefined ? sessionTitle.get(agent.session)?.title : undefined;
                return { ...row, ...(title !== undefined ? { title } : {}) };
            });
            return { sessions: items };
        },
        presentCall() {
            return { card: 'generic', title: '列出会话' };
        },
    }));
}
/** 注册 session_info 工具：返回当前会话（本 agent 运行所在会话）的身份与归属信息。 */
function applyInfoTool(ctx, sandbox, deps) {
    ctx.tools.register(defineTool({
        name: 'current_session_info',
        description: 'Get information about the current session (the session this agent is running in): its id, cwd, title, and workspace membership.',
        parameters: {
            ...(sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}),
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    session_id: { type: 'string', required: true },
                    cwd: { type: 'string' },
                    title: { type: 'string' },
                    workspace_id: { type: 'string' },
                    workspace_title: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `当前会话 ${value.session_id}${value.title !== undefined ? '（' + value.title + '）' : ''}${value.cwd !== undefined ? ' cwd: ' + value.cwd : ''}${value.workspace_id !== undefined ? ' 工作区: ' + value.workspace_id : ''}` }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            await sandbox.resolveEscalation('current_session_info', args, exec);
            const agent = exec.agent;
            if (agent === undefined)
                throw new Error('no agent: cannot read the current session');
            const session = agent.session;
            const sessionId = session.header.id;
            const cwd = session.header.cwd;
            const sessionTitle = deps.sessionTitle();
            const title = sessionTitle !== undefined ? sessionTitle.get(session)?.title : undefined;
            const registry = deps.workspaceRegistry();
            let workspaceId;
            let workspaceTitle;
            if (registry !== undefined) {
                for (const ws of registry.list()) {
                    if (ws.sessionIds.some((id) => String(id) === String(sessionId))) {
                        workspaceId = String(ws.id);
                        workspaceTitle = ws.title;
                        break;
                    }
                }
            }
            return {
                session_id: String(sessionId),
                ...(cwd !== undefined ? { cwd } : {}),
                ...(title !== undefined ? { title } : {}),
                ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
                ...(workspaceTitle !== undefined ? { workspace_title: workspaceTitle } : {}),
            };
        },
        presentCall() {
            return { card: 'generic', title: '获取当前会话信息' };
        },
    }));
}
/** 注册全部 6 个会话管理工具。 */
export function registerSessionTools(ctx, sandbox, deps) {
    applyCreateTool(ctx, sandbox, deps);
    applyRenameTool(ctx, sandbox, deps);
    applyArchiveTool(ctx, sandbox, deps);
    applySwitchTool(ctx, sandbox, deps);
    applyListTool(ctx, sandbox, deps);
    applyInfoTool(ctx, sandbox, deps);
}
