/**
 * dsh-tool-session 插件入口：为模型提供会话创建/重命名/归档/切换/列表工具，
 * 沙箱挂载时统一声明提权参数（fail-closed 用户审批），并通过 SSE 事件流
 * （/api/tool-session/switch-events）实现 UI 层面的会话切换。
 *
 * @module dsh-tool-session
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { SessionSandboxController } from './sandbox.js';
export type { SessionEscalationArgs, EscalationSchemaFields } from './sandbox.js';
export { SwitchIntent } from './switch.js';
export type { SwitchIntentEvent, SwitchFramePayload } from './switch.js';
export type { ToolDeps } from './value.js';
/** Cordis 插件名（loader 诊断用）。 */
export declare const name = "tool-session";
/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export declare const inject: string[];
/** 自动归档的 schema 字段（均可缺省，由 default 填充）。 */
interface AutoArchiveSettings {
    /** 总开关，默认 false。 */
    enabled: boolean;
    /** 「过期」阈值天数：最后活跃时间早于 now - maxAgeDays 天视为过期，默认 30。 */
    maxAgeDays: number;
    /** 每组（工作区 / 未分组）最多保留的未归档会话数，默认 30。 */
    maxSessionsPerWorkspace: number;
}
/** 插件配置。DSH 0.1.7 起字段值是 volatile 引用（Loader 注入），按需 `.get()` 取当前值。 */
export interface SessionToolConfig {
    /** 自动归档扫描配置（可选；默认关闭）。 */
    autoArchive?: Volatile<AutoArchiveSettings>;
}
/**
 * 插件配置 schema（带默认值；autoArchive 默认关闭）。
 *
 * DSH 0.1.7 起只有标注 `.volatile()` 的字段会进入插件配置表单（未标注的字段既不显示、
 * 写入也会被 `Config field "x" is not volatile` 拒绝），故 autoArchive 整体标 volatile——
 * volatile 必须落在有固定对象路径的字段上，不能标在嵌套字段内部。
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    autoArchive: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        maxAgeDays: z<number, number, "defined">;
        maxSessionsPerWorkspace: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        maxAgeDays: z<number, number, "defined">;
        maxSessionsPerWorkspace: z<number, number, "defined">;
    }>>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    autoArchive: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        maxAgeDays: z<number, number, "defined">;
        maxSessionsPerWorkspace: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        maxAgeDays: z<number, number, "defined">;
        maxSessionsPerWorkspace: z<number, number, "defined">;
    }>>>, "volatile-defined">;
}>>, "plain">;
/** 本插件在 profile 中的条目 id（即 settings 命名空间，须与 cordis.patch.yml 的 `id:` 一致）。 */
export declare const SETTINGS_NAMESPACE = "tool-session";
/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export declare function apply(ctx: Context, config: SessionToolConfig): void;
