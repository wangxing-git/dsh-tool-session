/**
 * dsh-tool-session 插件入口：为模型提供会话创建/重命名/归档/切换/列表工具，
 * 沙箱挂载时统一声明提权参数（fail-closed 用户审批），并通过 /session-tool RPC
 * 通道 + client 端轮询实现 UI 层面的会话切换。
 *
 * @module dsh-tool-session
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { SessionSandboxController } from './sandbox.js';
export type { SessionEscalationArgs, EscalationSchemaFields } from './sandbox.js';
export { SwitchIntent } from './switch.js';
export type { ToolDeps } from './value.js';
/** Cordis 插件名（loader 诊断用）。 */
export declare const name = "tool-session";
/** 必需服务：工具注册表、agent 注册表（创建会话）、文件系统（沙箱能力探测）。 */
export declare const inject: string[];
/** 插件配置。 */
export interface SessionToolConfig {
    /** 自动归档扫描配置（可选；默认关闭）。 */
    autoArchive?: {
        /** 总开关，默认 false。 */
        enabled?: boolean;
        /** 「过期」阈值天数：最后活跃时间早于 now - maxAgeDays 天视为过期，默认 30。 */
        maxAgeDays?: number;
        /** 每组（工作区 / 未分组）最多保留的未归档会话数，默认 30。 */
        maxSessionsPerWorkspace?: number;
    };
}
/** 插件配置 schema（带默认值；autoArchive 默认关闭）。 */
export declare const Config: z<Schemastery.ObjectS<{
    autoArchive: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxAgeDays: z<number, number>;
        maxSessionsPerWorkspace: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxAgeDays: z<number, number>;
        maxSessionsPerWorkspace: z<number, number>;
    }>>;
}>, Schemastery.ObjectT<{
    autoArchive: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        maxAgeDays: z<number, number>;
        maxSessionsPerWorkspace: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        maxAgeDays: z<number, number>;
        maxSessionsPerWorkspace: z<number, number>;
    }>>;
}>>;
/** settings.yaml 顶层 namespace（插件短名 tool-session）。 */
export declare const SETTINGS_NAMESPACE = "tool-session";
/** 插件主体：注册 7 个会话工具与切换意图 RPC 端点。 */
export declare function apply(ctx: Context, config: SessionToolConfig): void;
