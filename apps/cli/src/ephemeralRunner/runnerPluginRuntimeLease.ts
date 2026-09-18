import type { AgentExecutionTargetV1 } from '@happier-dev/protocol';

import { activateAgentRuntimeContributionOnDemand } from '@/agent/runtime/registry/activationDemand';
import type { PluginRuntimeRegistryLease } from '@/plugins/runtime/reload/controller';
import { createEphemeralPluginRuntimeRegistryLease } from '@/plugins/runtime/reload/runtimeLease';
import { resolveExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';
import type { StablePluginConnectedAccountsOwner } from '@/plugins/runtime/invocation/services/connectedAccounts';
import type { StoredCredentials } from '@/persistence';
import type { RuntimeActionSettingsProvider } from '@/settings/actionsSettingsProvider';

import { resolveReviewedRunnerAgentTarget } from './resolveReviewedAgentTarget';

export class RunnerReviewedPluginRuntimeUnavailableError extends Error {
  readonly code = 'runner_reviewed_plugin_runtime_unavailable' as const;

  constructor(
    readonly pluginId: string,
    readonly localId: string,
  ) {
    super(`Reviewed Runner plugin runtime '${pluginId}/${localId}' is unavailable`);
    this.name = 'RunnerReviewedPluginRuntimeUnavailableError';
  }
}

export type ReviewedRunnerPluginRuntimeHandle = Readonly<{
  lease: PluginRuntimeRegistryLease;
  selected: Readonly<{
    pluginId: string;
    localId: string;
    agentId: string;
    backendId: string;
    runtimeSpec: NonNullable<ReturnType<typeof resolveReviewedRunnerAgentTarget>>['runtimeSpec'];
    immutableGenerationId: string | null;
  }>;
  release(): Promise<void>;
}>;

/**
 * Opens the canonical executable-plugin registry over the activation-local
 * Runner home and pins it for the Session lifetime.
 *
 * This is deliberately a consumer, not a distribution path. The reviewed
 * external generation must already have been acquired and committed into this
 * home by the plugin distribution/install owner. Missing bytes or authority
 * fail before Agent installation; this function never imports source directly
 * or substitutes the immutable Runner bundle for an external generation.
 */
export async function acquireReviewedRunnerPluginRuntimeLease(input: Readonly<{
  happyHomeDir: string;
  target: AgentExecutionTargetV1;
  signal?: AbortSignal;
  connectedAccounts?: StablePluginConnectedAccountsOwner;
  /** Exact restricted runtime authority for plugin-to-plugin Action calls. */
  scopedActionRuntime?: Readonly<{
    credentials: StoredCredentials | null;
    actionsSettingsProvider: RuntimeActionSettingsProvider;
  }>;
}>): Promise<ReviewedRunnerPluginRuntimeHandle> {
  input.signal?.throwIfAborted();
  const registry = await resolveExecutablePluginRuntimeRegistry({
    happyHomeDir: input.happyHomeDir,
    generation: 1,
    pluginIds: [input.target.identity.pluginId],
    ...(input.connectedAccounts ? { connectedAccounts: input.connectedAccounts } : {}),
    ...(input.scopedActionRuntime ? { scopedActionRuntime: input.scopedActionRuntime } : {}),
  });
  const lease = createEphemeralPluginRuntimeRegistryLease(registry);
  try {
    const selected = resolveReviewedRunnerAgentTarget({
      contributions: registry.contributes,
      target: input.target,
    });
    const contribution = selected
      ? registry.contributes.agentDefinitionsById.get(selected.agentId)
      : null;
    const currentGeneration = registry.pluginFinalPolicyCurrentGenerationsById
      ?.get(input.target.identity.pluginId) ?? null;
    const reviewedExternalGenerationId = contribution?.provenance === 'external'
      ? currentGeneration?.immutableGenerationId ?? null
      : null;
    const reviewedIdentity = contribution?.identity;
    if (
      !selected
      || !contribution
      || !reviewedIdentity
      || reviewedIdentity.pluginId !== input.target.identity.pluginId
      || reviewedIdentity.localId !== input.target.identity.localId
      || (
        contribution.provenance === 'external'
        && (
          reviewedExternalGenerationId === null
          || currentGeneration?.desiredImmutableGenerationId !== reviewedExternalGenerationId
        )
      )
    ) {
      throw new RunnerReviewedPluginRuntimeUnavailableError(
        input.target.identity.pluginId,
        input.target.identity.localId,
      );
    }

    await activateAgentRuntimeContributionOnDemand(registry, selected.agentId);
    input.signal?.throwIfAborted();
    const appliedGeneration = registry.pluginFinalPolicyCurrentGenerationsById
      ?.get(input.target.identity.pluginId) ?? null;
    // On-demand activation reports diagnostics instead of throwing for several
    // integrity/currentness failures. A cold declaration is not an executable
    // Runner runtime: fail before managed Agent installation unless the exact
    // reviewed contribution actually registered through activate(api).
    if (
      !registry.activatedPluginIds.has(reviewedIdentity.pluginId)
      || !registry.agentRuntimesByAgentId.has(selected.agentId)
      || (
        contribution.provenance === 'external'
        && (
          appliedGeneration?.applied !== true
          || appliedGeneration.immutableGenerationId !== reviewedExternalGenerationId
        )
      )
    ) {
      throw new RunnerReviewedPluginRuntimeUnavailableError(
        input.target.identity.pluginId,
        input.target.identity.localId,
      );
    }
    return Object.freeze({
      lease,
      selected: Object.freeze({
        pluginId: input.target.identity.pluginId,
        localId: input.target.identity.localId,
        agentId: selected.agentId,
        backendId: selected.backendId,
        runtimeSpec: selected.runtimeSpec,
        immutableGenerationId: appliedGeneration?.immutableGenerationId ?? null,
      }),
      release: lease.release,
    });
  } catch (error) {
    await lease.release();
    throw error;
  }
}
