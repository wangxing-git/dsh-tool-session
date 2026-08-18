import { approveEscalation, ESCALATION_TARGETS, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox';
/**
 * 会话工具的沙箱提权控制器：广告门控、per-call 审批解析。
 * 纯 `ctx` 产物，插件 apply 时构造一次，被 5 个工具共享。
 */
export class SessionSandboxController {
    ctx;
    /** 本组合广告的提权目标（未挂载限制性后端时为 `[]`）。 */
    escalationModes;
    /** 限制性后端必需的 per-session 策略解析器。 */
    policy;
    constructor(ctx) {
        this.ctx = ctx;
        const defaultMode = ctx.fs.sandboxMode;
        this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS;
        this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy');
        if (defaultMode !== undefined && this.policy === undefined) {
            throw new Error('tool-session: 已挂载限制性文件系统，但 ctx.sandboxPolicy 缺失');
        }
    }
    /**
     * 提权参数的 schema 字段。仅在限制性后端下调用（以 `escalationModes` 为守卫）；
     * enum 钉住封闭目标词汇，严格更宽校验在每次调用的执行期进行。
     */
    schemaFields() {
        return {
            sandbox_permissions: {
                type: 'string',
                enum: [...this.escalationModes],
                description: 'The wider sandbox mode this session operation needs. Only valid as a one-shot retry of an operation the sandbox just denied; requires justification and user approval.',
            },
            justification: {
                type: 'string',
                description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact session operation needs the wider access.',
            },
        };
    }
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
    async resolveEscalation(toolName, args, exec) {
        const input = (args ?? {});
        validateEscalationArgs(input.sandbox_permissions, input.justification);
        const hasRequest = input.sandbox_permissions !== undefined || input.justification !== undefined;
        if (!hasRequest)
            return;
        if (this.escalationModes.length === 0) {
            throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)');
        }
        const standingPolicy = this.policy.resolve({ ...(exec.agent !== undefined ? { session: exec.agent.session } : {}) });
        await approveEscalation({
            requestedMode: input.sandbox_permissions,
            justification: input.justification,
            effectiveMode: standingPolicy.mode,
            subject: 'session operation',
        }, {
            approver: this.ctx.get('approval'),
            agent: exec.agent,
            callId: exec.callId,
            toolName,
            signal: exec.signal,
        });
    }
}
