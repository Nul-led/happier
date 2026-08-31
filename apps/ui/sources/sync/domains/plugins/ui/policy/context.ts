import type { PluginUiPolicyEvaluationContext } from './evaluate';

export type PluginUiPolicyEvaluationContextInput = PluginUiPolicyEvaluationContext | null | undefined;
type MutablePluginUiPolicyEvaluationContext = {
    -readonly [Key in keyof PluginUiPolicyEvaluationContext]?: PluginUiPolicyEvaluationContext[Key];
};

function isDefined<T>(value: T | null | undefined): value is T {
    return value !== undefined && value !== null;
}

export function createPluginUiPolicyEvaluationContext(
    ...contexts: readonly PluginUiPolicyEvaluationContextInput[]
): PluginUiPolicyEvaluationContext {
    const merged: MutablePluginUiPolicyEvaluationContext = {};
    for (const context of contexts) {
        if (!context) {
            continue;
        }
        if (isDefined(context.platform)) merged.platform = context.platform;
        if (isDefined(context.channel)) merged.channel = context.channel;
        if (isDefined(context.profileMode)) merged.profileMode = context.profileMode;
        if (context.isFeatureEnabled) merged.isFeatureEnabled = context.isFeatureEnabled;
        if (context.isPermissionGranted) merged.isPermissionGranted = context.isPermissionGranted;
        if (context.isCapabilityEnabled) merged.isCapabilityEnabled = context.isCapabilityEnabled;
        if ('data' in context) merged.data = context.data;
    }
    return Object.freeze(merged);
}

export type PluginUiSessionPolicyFacts = Readonly<{
    pluginEnabled: boolean;
    sessionAgentId: string | null;
    sessionState: string | null;
    machineId: string | null;
    projectId: string | null;
    browserExists: boolean;
}>;

/**
 * Projects the facts owned by a mounted Session into the one plugin policy
 * context. Capability facts stay resolver-owned: callers must not infer them
 * from presentation state or feature bits.
 */
export function createPluginUiSessionPolicyEvaluationContext(
    context: PluginUiPolicyEvaluationContextInput,
    facts: PluginUiSessionPolicyFacts,
): PluginUiPolicyEvaluationContext {
    const projectId = typeof facts.projectId === 'string' && facts.projectId.trim().length > 0
        ? facts.projectId.trim()
        : undefined;
    return createPluginUiPolicyEvaluationContext(context, {
        data: Object.freeze({
            plugin: Object.freeze({ enabled: facts.pluginEnabled }),
            session: Object.freeze({
                exists: true,
                ...(facts.sessionAgentId ? { agentId: facts.sessionAgentId } : {}),
                ...(facts.sessionState ? { state: facts.sessionState } : {}),
            }),
            machine: Object.freeze({
                ...(facts.machineId ? { id: facts.machineId } : {}),
            }),
            project: Object.freeze({
                exists: projectId !== undefined,
                ...(projectId ? { id: projectId } : {}),
            }),
            browser: Object.freeze({ exists: facts.browserExists }),
        }),
    });
}
