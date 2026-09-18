import { agentDeclaresManagedCliInstall } from '@happier-dev/agents';
import type {
    TeamCredentialProviderModelSelectionV1,
    TeamCredentialResourceCatalogEntryV1,
} from '@happier-dev/protocol/teams';
import { SessionInitialAccessMaterializedV1Schema } from '@happier-dev/protocol';

import { resolveBundledAgentIdFromContributionIdentity } from '@/agents/catalog/catalog';
import type { TemporaryComputerCreatorDependencies } from '../useNewSessionScreenModel';

/**
 * The exact producer facts a creator decision needs but cannot currently obtain.
 *
 * These are reported rather than guessed. A creator that fabricated a broker
 * machine, a resource revision or a reviewed model would hand the endpoint
 * authority nobody granted, so every gap here fails the decision closed and
 * surfaces as a typed unavailable state instead of a silent no-op control.
 */
export type TemporaryComputerCreatorProducerGap =
    /** The Agent has no unattended managed CLI install recipe, so a fresh computer cannot install it. */
    | 'agent_managed_install_undeclared'
    /** No current, brokerable Team credential resource offers a model for the selected Agent. */
    | 'team_credential_resource_unavailable'
    /** Authoring has not selected a Team credential model to broker. */
    | 'team_credential_model_unselected'
    | 'broker_selection_unavailable';

export type TemporaryComputerCreatorComposition = Readonly<{
    dependencies: TemporaryComputerCreatorDependencies;
    /** Gaps observed by the most recent decision, for truthful surface reporting. */
    readGaps: () => readonly TemporaryComputerCreatorProducerGap[];
}>;

function resourceKey(resource: Readonly<{ teamId: string; id: string }>): string {
    return `${resource.teamId}:${resource.id}`;
}

/**
 * Composes the concrete Temporary-computer creator producers from facts the
 * mounted New Session owner already holds.
 *
 * It is deliberately a pure factory over projections rather than a hook: the
 * authoring model owns the Agent catalog, the entitled Team credential catalog
 * and the current model selection, so a second hook would open a duplicate
 * store for facts that are already loaded once.
 */
export function createTemporaryComputerCreatorDependencies(facts: Readonly<{
    /**
     * Exact Home the entitled catalog below was read for.
     *
     * Resource ids and revisions are only unique within a Home, so an answer
     * given without this identity could freeze one Home's resource into another
     * Home's activation. Absent identity therefore fails closed rather than
     * falling back to whichever Home happens to be in focus.
     */
    teamCredentialServerId: string | null;
    teamCredentialResources: readonly TeamCredentialResourceCatalogEntryV1[];
    /** Only exact, non-stale rows may admit a launch. */
    currentTeamCredentialResourceKeys: ReadonlySet<string>;
    selectedTeamCredentialModel: TeamCredentialProviderModelSelectionV1 | null;
}>): TemporaryComputerCreatorComposition {
    const gaps = new Set<TemporaryComputerCreatorProducerGap>();
    const note = (gap: TemporaryComputerCreatorProducerGap): false => {
        gaps.add(gap);
        return false;
    };
    const qualifiedHomeServerId = facts.teamCredentialServerId?.trim() ?? '';

    const brokerableModelExistsFor = (agentTargetKey: string): boolean => (
        facts.teamCredentialResources.some((resource) => (
            facts.currentTeamCredentialResourceKeys.has(resourceKey(resource))
            && resource.mayBroker
            && resource.readiness.kind === 'available'
            && resource.providerModels.some((model) => (
                model.availability === 'available'
                && model.selection.deliveryMode === 'brokered'
                && model.selection.agentTargetKey === agentTargetKey
            ))
        ))
    );

    const exactSelectedProviderModel = (agentTargetKey: string) => {
        const selected = facts.selectedTeamCredentialModel;
        if (!selected) {
            note('team_credential_model_unselected');
            return null;
        }
        const resource = facts.teamCredentialResources.find((candidate) => (
            candidate.id === selected.resourceId
            && candidate.resourceRevision === selected.expectedResourceRevision
            && facts.currentTeamCredentialResourceKeys.has(resourceKey(candidate))
        ));
        if (!resource || !resource.mayBroker || resource.readiness.kind !== 'available') {
            note('team_credential_resource_unavailable');
            return null;
        }
        const providerModel = resource.providerModels.find((candidate) => (
            candidate.availability === 'available'
            && candidate.selection.resourceId === selected.resourceId
            && candidate.selection.teamId === selected.teamId
            && candidate.selection.expectedResourceRevision === selected.expectedResourceRevision
            && candidate.selection.agentTargetKey === agentTargetKey
            && candidate.selection.agentTargetKey === selected.agentTargetKey
            && candidate.selection.modelId === selected.modelId
            && candidate.selection.deliveryMode === selected.deliveryMode
            && candidate.selection.deliveryMode === 'brokered'
        ));
        if (!providerModel) {
            note('team_credential_resource_unavailable');
            return null;
        }
        gaps.delete('team_credential_model_unselected');
        gaps.delete('team_credential_resource_unavailable');
        return providerModel;
    };

    const dependencies: TemporaryComputerCreatorDependencies = {
        isAuthoringCompatible: ({ backendTargetKey, agentTarget }) => {
            if (!qualifiedHomeServerId) return note('broker_selection_unavailable');
            const agentId = resolveBundledAgentIdFromContributionIdentity(agentTarget.identity);
            // An externally installed Agent publishes no bundled install recipe,
            // and an Agent whose only install path is a vendor guide cannot be
            // set up by an unattended endpoint. Both fail closed here.
            if (!agentId || !agentDeclaresManagedCliInstall(agentId)) {
                return note('agent_managed_install_undeclared');
            }
            if (!brokerableModelExistsFor(backendTargetKey)) {
                return note('team_credential_resource_unavailable');
            }
            gaps.delete('agent_managed_install_undeclared');
            gaps.delete('team_credential_resource_unavailable');
            return true;
        },

        isLaunchReady: ({ backendTargetKey, agentTarget }) => (
            dependencies.isAuthoringCompatible({ backendTargetKey, agentTarget })
            && exactSelectedProviderModel(backendTargetKey) !== null
        ),

        resolveCredentialSelectionBinding: async ({ projection, preparedAuthoring, client, signal }) => {
            if (!qualifiedHomeServerId) {
                note('broker_selection_unavailable');
                return null;
            }
            const providerModel = facts.selectedTeamCredentialModel
                ? exactSelectedProviderModel(facts.selectedTeamCredentialModel.agentTargetKey)
                : (note('team_credential_model_unselected'), null);
            if (!providerModel) return null;
            const authoring = preparedAuthoring.authoring;
            const teamVisibilityTeamIds = [...new Set((authoring.access?.grants ?? []).flatMap((grant) => {
                const subject = grant.subject;
                return subject.kind === 'team' || subject.kind === 'group' ? [subject.teamId] : [];
            }))];
            const resolution = await client.resolveCredentialSelection(projection.activationId, {
                v: 1,
                selection: providerModel.selection,
                application: providerModel.application,
                sourceRevision: providerModel.sourceRevision,
                plannedSession: {
                    primaryTeamId: authoring.primaryTeamId ?? null,
                    teamVisibilityTeamIds,
                },
            }, signal);
            if (resolution.status !== 'resolved') {
                note('broker_selection_unavailable');
                return null;
            }
            gaps.delete('broker_selection_unavailable');
            return {
                binding: resolution.credentialSelectionBinding,
                reviewedProviderModel: providerModel,
                displayFacts: resolution.displayFacts,
            };
        },

        resolveMaterializationInput: async ({ custody }) => {
            const authoring = custody.preparedAuthoring.authoring;
            const grants = authoring.access?.grants ?? [];
            const credentialSelection = custody.launchManifest.credentialSelectionBinding;
            const reviewedSelection = custody.launchManifest.reviewedProviderModel.selection;
            if (
                reviewedSelection.deliveryMode !== 'brokered'
                || reviewedSelection.resourceId !== credentialSelection.resourceId
                || reviewedSelection.expectedResourceRevision !== credentialSelection.revision
            ) {
                note('team_credential_resource_unavailable');
                return null;
            }
            return {
                // Stable across materialization retries: the activation is the
                // launch identity, so a retry rejoins instead of racing a second
                // Session into existence.
                tag: `temporary-computer:${custody.binding.activationId}`,
                // No Agent has run yet. The endpoint publishes agent state through
                // the ordinary Session runtime once it starts.
                agentState: null,
                ...(grants.length > 0
                    ? { initialAccess: SessionInitialAccessMaterializedV1Schema.parse({ grants }) }
                    : {}),
                // The reviewed credential selection is already sealed into the
                // launch manifest. Materialization must persist that exact
                // resource/revision on the Session or readiness can pass while
                // the first real Provider request has no broker authority.
                teamCredentialBindings: [{
                    v: 1,
                    slot: { kind: 'provider_model' },
                    resourceId: credentialSelection.resourceId,
                    expectedResourceRevision: credentialSelection.revision,
                    deliveryMode: reviewedSelection.deliveryMode,
                    teamId: reviewedSelection.teamId,
                }],
            };
        },
    };

    return { dependencies, readGaps: () => Object.freeze([...gaps]) };
}
