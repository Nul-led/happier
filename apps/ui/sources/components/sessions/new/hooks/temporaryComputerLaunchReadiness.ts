import type { TemporaryComputerCreatorProducerGap } from './creator/temporaryComputerCreatorDependencies';
import {
    findRunnerUnsupportedAuthoringField,
    type RunnerUnsupportedAuthoringField,
} from '@/sync/domains/ephemeralRunner/runnerAuthoringCompatibility';

export type TemporaryComputerUnsupportedAuthoringBlock =
    `authoring_${RunnerUnsupportedAuthoringField}_unsupported`;

export type TemporaryComputerLaunchBlock =
    | TemporaryComputerCreatorProducerGap
    | TemporaryComputerUnsupportedAuthoringBlock;

/**
 * Ordered by which recovery the user can actually perform.
 *
 * A missing unattended install recipe cannot be fixed from the model picker, so
 * it is reported before any credential gap; an entitled-resource problem is
 * reported before "nothing selected yet", because selecting the same unusable
 * resource again would not help.
 */
const LAUNCH_BLOCK_PRIORITY = [
    'authoring_connectedServices_unsupported',
    'authoring_transcriptStorage_unsupported',
    'authoring_environmentVariables_unsupported',
    'authoring_windowsRemoteSessionLaunchMode_unsupported',
    'authoring_windowsRemoteSessionConsole_unsupported',
    'authoring_windowsTerminalWindowName_unsupported',
    'authoring_runtimeDescriptorV1_unsupported',
    'authoring_automation_unsupported',
    'agent_managed_install_undeclared',
    'team_credential_resource_unavailable',
    'team_credential_model_unselected',
    'broker_selection_unavailable',
] as const satisfies readonly TemporaryComputerLaunchBlock[];

/**
 * Destination eligibility and launch readiness are separate contracts.
 *
 * The picker asks whether Temporary computer is a real destination on this Home;
 * this owner asks whether *this* authored request can actually be launched onto
 * it. A `false` readiness with no recorded gap still blocks — an unexplained
 * readiness answer must never open the launch path.
 */
export function resolveTemporaryComputerLaunchBlock(input: Readonly<{
    ready: boolean;
    gaps: readonly TemporaryComputerLaunchBlock[];
    authoring?: Parameters<typeof findRunnerUnsupportedAuthoringField>[0];
    selectedAgentProviderOwnedEnvironmentKeys?: readonly string[];
}>): TemporaryComputerLaunchBlock | null {
    if (input.authoring) {
        const field = findRunnerUnsupportedAuthoringField(
            input.authoring,
            input.selectedAgentProviderOwnedEnvironmentKeys,
        );
        if (field !== null) return `authoring_${field}_unsupported`;
    }
    if (input.ready) return null;
    return LAUNCH_BLOCK_PRIORITY.find((candidate) => input.gaps.includes(candidate))
        ?? 'broker_selection_unavailable';
}
