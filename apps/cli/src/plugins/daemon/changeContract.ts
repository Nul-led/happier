import {
  type PluginRequestInterceptorContributionV1,
  type PluginUpdatePolicyV1,
} from '@happier-dev/protocol';
import {
  type ExpectedMarketplaceListingV1,
  type PluginChangePendingReviewResult,
  type PluginDevelopmentSourceRootReview,
  type PluginInstallationReview,
  type PluginInstallationReviewRequestInterceptor,
} from '@happier-dev/protocol/marketplace/internal';

export type PluginChangeRequest =
  | Readonly<{ kind: 'installPath'; locator: string; development: boolean; sdkRegistryOrigin?: string }>
  | Readonly<{ kind: 'installArchive'; locator: string; expectedIntegrity?: string }>
  | Readonly<{
      kind: 'installNpm';
      packageName: string;
      selector?: string;
      registryOrigin?: string;
      registryProfileId?: string;
      expectedMarketplaceListing?: ExpectedMarketplaceListingV1;
    }>
  | Readonly<{ kind: 'update'; pluginId: string }>
  | Readonly<{ kind: 'setUpdatePolicy'; pluginId: string; policy: PluginUpdatePolicyV1 }>
  | Readonly<{
      kind: 'development';
      pluginId?: string;
      sourceRootPath: string;
      changedPaths?: readonly string[];
      sdkRegistryOrigin?: string;
    }>
  | Readonly<{ kind: 'enable' | 'disable' | 'rollback' | 'forgetTrust'; pluginId: string }>
  | Readonly<{ kind: 'uninstall' | 'uninstallAndDeleteData'; pluginId: string }>;

/**
 * Projects one declared request-policy contribution into the serialized
 * installation-review fact a human reviews. The review fact schema and shape
 * are owned by `@happier-dev/protocol/marketplace/internal`; this is the
 * daemon-side emitter for that fact.
 */
export function projectPluginInstallationReviewRequestInterceptor(
  contribution: PluginRequestInterceptorContributionV1,
): PluginInstallationReviewRequestInterceptor {
  return Object.freeze({
    id: contribution.id,
    origins: Object.freeze([...contribution.origins].sort()),
    ...(contribution.methods === undefined
      ? {}
      : { methods: Object.freeze([...contribution.methods].sort()) }),
    priority: contribution.priority ?? 0,
  });
}

export type PluginResourceSelection = Readonly<{
  accessId: string;
  selected: boolean;
}>;

export type PluginChangePendingSurface =
  | 'reconciliation'
  | 'retirement'
  | 'cleanup'
  | 'temporaryCandidateCleanup';

export type PluginChangeSuccess = Readonly<{
  kind: 'committed';
  pluginId: string;
  desiredGeneration: string | null;
  appliedGeneration: string | null;
  pendingSurfaces: readonly PluginChangePendingSurface[];
  dataRemoval?: Readonly<{
    alreadyUninstalled: boolean;
    removedData: Readonly<{
      daemonStorage: boolean;
      secrets: boolean;
    }>;
  }>;
}>;

export type PluginDataRemovalStep = 'uninstall' | 'daemonStorage' | 'secrets';

export type PluginDataRemovalPartial = Readonly<{
  kind: 'dataRemovalPartial';
  pluginId: string;
  completed: readonly PluginDataRemovalStep[];
  pending: readonly PluginDataRemovalStep[];
  causeCode: string;
}>;

export type PluginChangeApplyResult =
  | PluginChangeSuccess
  | PluginDataRemovalPartial
  | Readonly<{ kind: 'unavailable'; code: string }>
  | Readonly<{ kind: 'conflict'; pluginId: string }>
  | Readonly<{ kind: 'failed'; code: string; message?: string }>
  | Readonly<{ kind: 'outcomeUnknown'; pluginId: string; expectedCandidate?: string }>;

export type PluginChangeRequestResult =
  | PluginChangePendingReviewResult
  | PluginChangeApplyResult
  | Readonly<{ kind: 'busy'; pluginId: string }>;

/**
 * A decision names the daemon-issued pending change it answers and nothing
 * about its own author. The authenticated control route establishes that a
 * local present user is calling, and the change service resolves the pending
 * change itself, so a caller-supplied actor, interaction id, or timestamp
 * would be self-asserted rather than evidence. Approval and selection times
 * are taken from the daemon clock where the record is written.
 */
export type PluginChangeDecision =
  | Readonly<{
      pendingChangeId: string;
      decision: 'trustSourceRoot';
    }>
  | Readonly<{
      pendingChangeId: string;
      decision: 'installAndTrust';
      optionalSelections?: readonly PluginResourceSelection[];
    }>
  | Readonly<{
      pendingChangeId: string;
      decision: 'cancel';
    }>;

export type PluginChangeDecisionResult =
  | PluginChangeRequestResult
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'expired' }>
  | Readonly<{ kind: 'busy'; pluginId: string }>;

/**
 * A reconnect carries only the daemon-issued pending id. It never recreates a
 * candidate or supplies approval evidence.
 */
export type PluginChangeStatusRequest = Readonly<{
  pendingChangeId: string;
}>;

export type PluginChangeTerminalResult = Exclude<
  PluginChangeDecisionResult,
  PluginChangePendingReviewResult | Readonly<{ kind: 'expired' }>
>;

/**
 * One daemon-lifetime pending change, as enumerated for a present user.
 *
 * It is exactly the subset of {@link PluginChangeStatusResult} that is still
 * waiting on, or executing, a decision. A terminal or expired change is nobody's
 * outstanding decision and is therefore never listed. Enumeration exists because
 * a change an Agent prepared has no caller left to hand the issued id to: the
 * change owner is the only place that knows a present user still owes a
 * decision.
 */
export type PluginPendingChangeEntry =
  | PluginChangePendingReviewResult
  | Readonly<{
      kind: 'applying';
      pendingChangeId: string;
    }>;

export type PluginChangeListResult = Readonly<{
  changes: readonly PluginPendingChangeEntry[];
}>;

/**
 * Daemon-lifetime only rejoin projection. A new daemon has no claim over a
 * predecessor's in-memory candidates, so callers receive `expired` after a
 * restart rather than a synthetic recovery record.
 */
export type PluginChangeStatusResult =
  | PluginChangePendingReviewResult
  | Readonly<{
      kind: 'applying';
      pendingChangeId: string;
    }>
  | Readonly<{
      kind: 'terminal';
      pendingChangeId: string;
      result: PluginChangeTerminalResult;
    }>
  | Readonly<{ kind: 'expired' }>
  | Readonly<{ kind: 'daemonUnavailable' }>;

export type PreparedDaemonPluginChangeCandidate = Readonly<{
  pluginId: string;
  review?: PluginInstallationReview;
  requiresReview?: boolean;
  apply: (decision?: Readonly<{
    optionalSelections: readonly PluginResourceSelection[];
  }>, control?: Readonly<{
    /** Releases same-plugin apply exclusivity after the serving lease is swapped. */
    onApplied: () => void;
  }>) => Promise<PluginChangeApplyResult>;
  cleanup: () => Promise<void>;
}>;

export type PreparedDaemonPluginSourceRootApproval = Readonly<{
  kind: 'sourceRootApprovalRequired';
  pendingKey: string;
  review: PluginDevelopmentSourceRootReview;
  continueAfterSourceRootApproval: () => Promise<PreparedDaemonPluginChangeCandidate>;
  cleanup: () => Promise<void>;
}>;

export type PreparedDaemonPluginChange =
  | PreparedDaemonPluginChangeCandidate
  | PreparedDaemonPluginSourceRootApproval;
