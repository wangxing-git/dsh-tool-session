/**
 * 会话管理工具的沙箱提权 API：per-call 提权解析、广告字段，与 bash/fs 共用
 * `@deepseek-ai/dsh-sandbox` 的词汇与 fail-closed 审批序列（同款
 * `approveEscalation` / `validateEscalationArgs`）。会话操作本身经 host 服务
 * （`ctx.agents` / `ctx.sessionTitle` / `ctx.workspaceRegistry`）完成、不产生文件策略，
 * 因此提权在此承担「用户对越界会话操作的知情同意」这一审批关卡角色。
 *
 * 构建时机：每个插件实例一次，来自 `ctx.fs.sandboxMode`（能力事实——是否挂载限制性后端）。
 *
 * @module dsh-tool-session/sandbox
 */
import type { Context } from '@deepseek-ai/cordis';
import { type SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** 工具参数中可能携带的两个提权参数（仅在挂载限制性后端时由 schema 声明）。 */
export interface SessionEscalationArgs {
    sandbox_permissions?: string;
    justification?: string;
}
/** 提权参数的 schema 字段，展开进工具的 `parameters`。 */
export interface EscalationSchemaFields {
    sandbox_permissions: {
        type: 'string';
        enum: string[];
        description: string;
    };
    justification: {
        type: 'string';
        description: string;
    };
}
/**
 * 会话工具的沙箱提权控制器：广告门控、per-call 审批解析。
 * 纯 `ctx` 产物，插件 apply 时构造一次，被 5 个工具共享。
 */
export declare class SessionSandboxController {
    private readonly ctx;
    /** 本组合广告的提权目标（未挂载限制性后端时为 `[]`）。 */
    readonly escalationModes: readonly SandboxMode[];
    /** 限制性后端必需的 per-session 策略解析器。 */
    private readonly policy;
    constructor(ctx: Context);
    /**
     * 提权参数的 schema 字段。仅在限制性后端下调用（以 `escalationModes` 为守卫）；
     * enum 钉住封闭目标词汇，严格更宽校验在每次调用的执行期进行。
     */
    schemaFields(): EscalationSchemaFields;
    /**
     * 解析本次会话操作的提权：先校验参数配对，未请求则直接通过；请求了但未挂载
     * 限制性后端则拒绝；否则经 `approveEscalation` 走 fail-closed 的用户审批，
     * 通过后返回（授予的模式本插件不消费——会话操作不产生文件策略）。
     * 任何拒绝路径都会抛错，由工具注册表转为 isError 结果，且不执行任何会话变更。
     *
     * @param toolName - 会话工具名，用于审批审计追踪。
     * @param args - 本次调用的原始参数（可能含提权字段）。
     * @param exec - 工具执行上下文（agent、callId、signal）。
     */
    resolveEscalation(toolName: string, args: unknown, exec: ToolExecution): Promise<void>;
}
