import type { SettingsPageGate } from './types';

type SettingsPageGateContext = Readonly<{
    useProfiles: boolean;
    devModeEnabled: boolean;
    tauriDesktop: boolean;
    features: Readonly<Record<string, boolean>>;
}>;

/** The catalog and declared Actions consume the same page-level admission decision. */
export function resolveSettingsPageGateUnavailableReason(
    gate: SettingsPageGate | undefined,
    context: SettingsPageGateContext,
): 'feature_disabled' | 'unsupported_host' | undefined {
    if (!gate) return undefined;
    if (gate.featureId && context.features[gate.featureId] !== true) return 'feature_disabled';
    if (gate.requiresProfiles && !context.useProfiles) return 'feature_disabled';
    if (gate.requiresDevMode && !context.devModeEnabled) return 'feature_disabled';
    if (gate.requiresTauriDesktop && !context.tauriDesktop) return 'unsupported_host';
    return undefined;
}
