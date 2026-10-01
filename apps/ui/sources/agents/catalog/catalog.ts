import type { AgentCoreConfig, MachineLoginKey } from '@/agents/registry/registryCore';
import {
    AGENT_IDS,
    DEFAULT_AGENT_ID,
    getAllAgentProviderOwnedEnvironmentKeys,
    getAgentCore as getExpoAgentCore,
    isBundledAgentId,
    resolveAgentIdFromCliDetectKey,
    resolveAgentIdFromConnectedServiceId,
    resolveAgentIdFromFlavor,
    resolveAgentIdFromSessionMetadata,
    type AgentId,
    type BundledAgentId,
} from '@/agents/registry/registryCore';

import type { AgentUiConfig } from '@/agents/registry/registryUi';
export { resolveBundledAgentIdFromContributionIdentity } from './resolveBundledAgentIdFromContributionIdentity';
type RegistryUiModule = typeof import('@/agents/registry/registryUi');
type AgentIconTintTheme = Parameters<RegistryUiModule['getAgentIconTintColor']>[1];
import * as RegistryUi from '@/agents/registry/registryUi';

import type { AgentUiBehavior } from '@/agents/registry/registryUiBehavior';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    buildResumeCapabilityOptionsFromUiState,
    buildNewSessionOptionsFromUiState,
    canSelectAgentWithoutDetectedCli,
    getNewSessionAgentInputExtraActionChips,
    buildSpawnEnvironmentVariablesFromUiState,
    buildResumeSessionExtrasFromUiState,
    buildSpawnSessionExtrasFromUiState,
    buildWakeResumeExtras,
    getAgentResumeExperimentsFromSettings,
    getNewSessionPreflightIssues,
    getNewSessionRelevantInstallableDepKeys,
    resolveAgentUiBehavior,
} from '@/agents/registry/registryUiBehavior';

export { AGENT_IDS, DEFAULT_AGENT_ID };
export { getAllAgentProviderOwnedEnvironmentKeys };
export type { AgentId, BundledAgentId, MachineLoginKey };

export type AgentCatalogEntry = Readonly<{
    id: AgentId;
    core: AgentCoreConfig;
    ui: AgentUiConfig;
    behavior: AgentUiBehavior;
}>;

function registryUi(): typeof RegistryUi {
    return RegistryUi;
}

export function getAgentCore(id: BundledAgentId): AgentCoreConfig;
export function getAgentCore(id: AgentId): AgentCoreConfig | null;
export function getAgentCore(id: AgentId): AgentCoreConfig | null {
    return getExpoAgentCore(id);
}

export function getAgentUi(id: AgentId): AgentUiConfig {
    return registryUi().getAgentUiConfig(id);
}

export function getAgentIconSource(agentId: string): ReturnType<RegistryUiModule['getAgentIconSource']> {
    return registryUi().getAgentIconSource(agentId);
}

export function getAgentIconSvgXml(
    agentId: string,
    theme: Parameters<RegistryUiModule['getAgentIconSvgXml']>[1],
): ReturnType<RegistryUiModule['getAgentIconSvgXml']> {
    return registryUi().getAgentIconSvgXml(agentId, theme);
}

/** Whether the Agent has a brand mark of its own (SVG or image); marks fall back to a neutral glyph without one. */
export function hasAgentIconMark(
    agentId: string,
    theme: Parameters<RegistryUiModule['getAgentIconSvgXml']>[1],
): boolean {
    return getAgentIconSvgXml(agentId, theme) != null || getAgentIconSource(agentId) != null;
}

export function getAgentIconTintColor(
    agentId: string,
    theme: AgentIconTintTheme,
): ReturnType<RegistryUiModule['getAgentIconTintColor']> {
    return registryUi().getAgentIconTintColor(agentId, theme);
}

export function getAgentAvatarOverlaySizes(
    agentId: string,
    size: number,
): ReturnType<RegistryUiModule['getAgentAvatarOverlaySizes']> {
    return registryUi().getAgentAvatarOverlaySizes(agentId, size);
}

export function getAgentPickerIconScale(agentId: string): ReturnType<RegistryUiModule['getAgentPickerIconScale']> {
    return registryUi().getAgentPickerIconScale(agentId);
}

export function getAgentCliGlyph(agentId: string): ReturnType<RegistryUiModule['getAgentCliGlyph']> {
    return registryUi().getAgentCliGlyph(agentId);
}

export function getAgentBehavior(id: AgentId, machineId?: string | null, accountScope?: ServerAccountScope | null): AgentUiBehavior {
    return resolveAgentUiBehavior(id, machineId, accountScope);
}

export function getAgent(id: BundledAgentId): AgentCatalogEntry {
    return {
        id,
        core: getAgentCore(id),
        ui: getAgentUi(id),
        behavior: getAgentBehavior(id),
    };
}

export {
    isBundledAgentId,
    resolveAgentIdFromFlavor,
    resolveAgentIdFromSessionMetadata,
    resolveAgentIdFromCliDetectKey,
    resolveAgentIdFromConnectedServiceId,
    getAgentResumeExperimentsFromSettings,
    buildResumeCapabilityOptionsFromUiState,
    getNewSessionPreflightIssues,
    buildNewSessionOptionsFromUiState,
    canSelectAgentWithoutDetectedCli,
    getNewSessionAgentInputExtraActionChips,
    getNewSessionRelevantInstallableDepKeys,
    buildSpawnEnvironmentVariablesFromUiState,
    buildSpawnSessionExtrasFromUiState,
    buildResumeSessionExtrasFromUiState,
    buildWakeResumeExtras,
};
