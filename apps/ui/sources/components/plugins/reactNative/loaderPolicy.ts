export type PluginReactNativeLoaderPolicyInput = Readonly<{
    source: 'installedArtifact';
}>;

export type PluginReactNativeLoaderPolicyDecision = Readonly<{
    canLoad: boolean;
    diagnostics: readonly string[];
}>;

export function resolvePluginReactNativeLoaderPolicy(
    input: PluginReactNativeLoaderPolicyInput | null | undefined,
): PluginReactNativeLoaderPolicyDecision {
    if (!input) {
        return Object.freeze({ canLoad: true, diagnostics: Object.freeze([]) });
    }
    if (input.source === 'installedArtifact') {
        return Object.freeze({ canLoad: true, diagnostics: Object.freeze([]) });
    }
    return Object.freeze({
        canLoad: false,
        diagnostics: Object.freeze(['unsupported_loader_source']),
    });
}
