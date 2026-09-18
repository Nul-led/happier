import type { DaemonMergedProjectionPhase } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import type { useMachineCapabilitiesCache } from '@/hooks/server/useMachineCapabilitiesCache';
import { type CapabilityId } from '@/sync/api/capabilities/capabilitiesProtocol';
import { t } from '@/text';
import {
    PluginChangePendingReviewResultSchema,
    type PluginDevelopmentSourceRootReview,
    type PluginInstallationReview,
} from '@happier-dev/protocol/marketplace/internal';
import type { PluginUpdatePolicyV1 } from '@happier-dev/protocol/marketplace';

export const MARKETPLACE_CAPABILITY_ID = 'tool.plugins' as CapabilityId;

export type PluginSettingsViewId = 'installed' | 'discover' | 'development' | 'diagnostics';

type PluginSettingsViewTranslationKey =
    | 'settingsPlugins.views.installed'
    | 'settingsPlugins.views.discover'
    | 'settingsPlugins.views.development'
    | 'settingsPlugins.views.diagnostics';

export function createPluginSettingsViews(
    translate: (key: PluginSettingsViewTranslationKey) => string,
): readonly Readonly<{ id: PluginSettingsViewId; label: string }>[] {
    return [
        { id: 'installed', label: translate('settingsPlugins.views.installed') },
        { id: 'discover', label: translate('settingsPlugins.views.discover') },
        { id: 'development', label: translate('settingsPlugins.views.development') },
        { id: 'diagnostics', label: translate('settingsPlugins.views.diagnostics') },
    ];
}

export type InstalledPluginDiagnostic = Readonly<{
    code: string;
    message: string;
    details?: unknown;
}>;

export type InstalledPluginDistribution =
    | Readonly<{ kind: 'npm'; registryOrigin: string; registryProfileId?: string; packageName: string }>
    | Readonly<{ kind: 'localPath'; canonicalPath: string }>
    | Readonly<{
        kind: 'archive';
        source: Readonly<{ kind: 'localFile'; canonicalPath: string }>
            | Readonly<{ kind: 'remoteUrl'; canonicalUrl: string }>;
        integrity: string;
    }>;

export type InstalledPluginEntry = Readonly<{
    pluginId: string;
    desiredGeneration?: string | null;
    appliedGeneration?: string | null;
    /** Verified NPM/archive acquisition SRI; local paths use generation custody. */
    admittedIntegrity?: string | null;
    title: string;
    description: string | null;
    version: string;
    enabled: boolean;
    rollbackAvailability?: 'available' | 'unavailable';
    source: Readonly<{
        kind: string;
        locator: string;
        devWatch?: boolean;
        trustPolicy?: string;
        installPolicy?: string;
        resolvedPath?: string;
    }>;
    install: Readonly<{
        mode: string;
        manifestVersion: string;
        installedPath?: string | null;
        updatePolicy?: PluginUpdatePolicyV1;
        trust?: Readonly<{
            pluginId: string;
            distribution: InstalledPluginDistribution;
            state: 'trusted';
            approvedAtMs: number;
        }>;
    }>;
    compatibility: Readonly<{
        status: string;
        diagnostics: readonly InstalledPluginDiagnostic[];
    }>;
    diagnostics: readonly InstalledPluginDiagnostic[];
}>;

export type InstalledPluginLifecycleCapabilities = Readonly<{
    canEnable: boolean;
    canDisable: boolean;
    canRollback: boolean;
    canUninstall: boolean;
    canForgetTrust: boolean;
    /**
     * Whether the canonical daemon update action can be offered from the
     * installed record alone.
     *
     * The daemon update owner reads the installed record's trusted update
     * channel; a record with no host trust left has no channel to advance, and
     * a bundled entry ships with the host. Whether that channel is *pinned* is
     * not part of the installed capability projection, so a pinned record still
     * reaches the daemon and is refused there with its own explanation rather
     * than being silently hidden here.
     */
    canUpdate: boolean;
}>;

/**
 * Projects only lifecycle operations the canonical catalog can perform for
 * this exact installed source. Bundled entries are host-derived, always-on
 * inventory: presenting ordinary install mutations for them would promise a
 * lifecycle the daemon deliberately rejects.
 */
export function projectInstalledPluginLifecycleCapabilities(
    installed: InstalledPluginEntry,
): InstalledPluginLifecycleCapabilities {
    const userManaged = installed.source.kind !== 'bundled';
    const trusted = installed.source.trustPolicy !== 'untrusted';
    return Object.freeze({
        canEnable: userManaged && !installed.enabled,
        canDisable: userManaged && installed.enabled,
        canRollback: userManaged && installed.rollbackAvailability === 'available',
        canUninstall: userManaged,
        canForgetTrust: userManaged && trusted,
        canUpdate: userManaged && trusted,
    });
}

export type DevelopmentPluginEntry = Readonly<{
    installed: InstalledPluginEntry;
    sourceRootPath: string;
    watch: Readonly<{ state: 'configured' }>;
    reload: Readonly<{
        state: 'clear' | 'attention';
        diagnostics: readonly InstalledPluginDiagnostic[];
    }>;
    actions: Readonly<{
        test: boolean;
        pack: boolean;
    }>;
}>;

export type PluginMarketplaceActionRequest = Readonly<{
    method: 'install' | 'update' | 'setUpdatePolicy' | 'rollback' | 'uninstall' | 'forgetTrust' | 'enable' | 'disable';
    pluginId: string;
    sourceId?: string;
    policy?: PluginUpdatePolicyV1;
}>;

/**
 * Why the plugin surfaces fell back to cached, read-only truth.
 *
 * `disconnected` is the machine being unreachable. `projectionUnavailable` is a
 * reachable machine whose contribution-registry projection failed or is not
 * served — a recoverable condition the user can retry, and one that must never
 * be reported as a disconnect. `accountRecovery` is Account-only truth with no
 * claim about a reachable machine or a retryable machine registry.
 */
export type PluginReadOnlySnapshotReason = 'disconnected' | 'projectionUnavailable' | 'installationUnavailable' | 'refreshing' | 'accountRecovery';

export type PluginReadOnlySnapshotNoticeState = Readonly<{
    reason: PluginReadOnlySnapshotReason;
}>;

export function resolvePluginReadOnlySnapshotNotice(params: Readonly<{
    daemonOperationsAvailable: boolean;
    daemonTransportOnline: boolean;
    projectionPhase: DaemonMergedProjectionPhase;
    hasCapabilitySnapshot: boolean;
    installedPluginCount: number;
    developmentPluginCount: number;
    hasCatalog: boolean;
    hasMarketplaceSourceRegistry: boolean;
    hasProjectionInputs: boolean;
    capabilityReadFailed?: boolean;
}>): PluginReadOnlySnapshotNoticeState | null {
    if (params.capabilityReadFailed) {
        return { reason: params.daemonTransportOnline ? 'installationUnavailable' : 'disconnected' };
    }
    if (params.daemonOperationsAvailable) {
        return null;
    }
    const projectionAnswered = params.projectionPhase === 'error' || params.projectionPhase === 'unsupported';
    if (params.daemonTransportOnline && !projectionAnswered) {
        return params.hasCapabilitySnapshot || params.installedPluginCount > 0 || params.developmentPluginCount > 0
            ? { reason: 'refreshing' }
            : null;
    }
    return {
        reason: params.daemonTransportOnline && projectionAnswered
            ? 'projectionUnavailable'
            : 'disconnected',
    };
}

export function isPluginMutationVisibleAfterRefresh(params: Readonly<{
    method: 'install' | 'update' | 'rollback' | 'uninstall' | 'forgetTrust';
    pluginId: string;
    before: InstalledPluginEntry | null;
    after: InstalledPluginEntry | null;
    targetVersion: string | null;
}>): boolean {
    if (params.method === 'uninstall') {
        return params.after === null;
    }
    if (params.method === 'forgetTrust') {
        return params.after?.source.trustPolicy === 'untrusted' && params.after.enabled === false;
    }
    if (params.method === 'install') {
        return params.before === null
            && params.after?.pluginId === params.pluginId
            && (params.targetVersion === null || params.after.version === params.targetVersion);
    }
    if (!params.before || !params.after || params.after.pluginId !== params.pluginId) {
        return false;
    }
    if (params.method === 'update' && params.targetVersion !== null) {
        return params.after.version === params.targetVersion
            && params.after.version !== params.before.version;
    }
    // An update the user never reviewed a candidate for has no caller-known
    // target: the canonical update owner reads the installed record, enforces its
    // policy and selects the newest compatible version, which is not the version
    // any catalog listing happens to advertise. The installed record advancing is
    // therefore the only honest evidence the change landed.
    return params.after.version !== params.before.version
        || params.after.admittedIntegrity !== params.before.admittedIntegrity
        || params.after.desiredGeneration !== params.before.desiredGeneration
        || params.after.appliedGeneration !== params.before.appliedGeneration;
}

/**
 * UI-local decision projection over the protocol-owned serialized review.
 *
 * The wire schema for the review facts themselves is
 * `PluginInstallationReviewSchema` in `@happier-dev/protocol/marketplace/internal`:
 * the daemon projects it, the CLI control client parses it, and this model
 * parses the exact same schema. Only the daemon-issued pending id beside the
 * parsed review is a UI-local carrier.
 */
export type PendingPluginChangeReview = Readonly<{
    pendingChangeId: string;
    review: PluginInstallationReview;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 32_768 ? trimmed : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Authorization to evaluate executable code from a local development source
 * root, before any package is reviewed or committed.
 *
 * This is deliberately a separate decision from `PendingPluginChangeReview`:
 * the user is being asked about a **filesystem location**, not about a package
 * identity, digests or host access — none of which exist yet, because the
 * daemon has not been allowed to read that root. The locator is the whole
 * security payload, so it is carried verbatim and shown verbatim.
 */
export type PendingPluginDevelopmentSourceRootReview = Readonly<{
    pendingChangeId: string;
    review: PluginDevelopmentSourceRootReview;
}>;

export function readPluginDevelopmentSourceRootReviewChange(
    change: unknown,
): PendingPluginDevelopmentSourceRootReview | null {
    if (!isRecord(change) || change.kind !== 'sourceRootReviewRequired') return null;
    const parsed = PluginChangePendingReviewResultSchema.safeParse(change);
    if (!parsed.success || parsed.data.kind !== 'sourceRootReviewRequired') return null;
    return {
        pendingChangeId: parsed.data.pendingChangeId,
        review: parsed.data.review,
    };
}

/**
 * A daemon-issued change that is waiting on a present user, in the exactly two
 * shapes a present user can be asked about: trust this folder, or install and
 * trust this package.
 *
 * This is the one reader for that pair. Every place a pending change reaches
 * the app — the result of a change this app started, the enumeration of changes
 * some other client prepared, and the by-id status rejoin — parses it here, so
 * the decision a screen offers can never disagree with the stage the daemon is
 * actually at.
 */
export type PendingPluginChangeDecision =
    | Readonly<{ kind: 'sourceRootReviewRequired'; sourceRootReview: PendingPluginDevelopmentSourceRootReview }>
    | Readonly<{ kind: 'reviewRequired'; installationReview: PendingPluginChangeReview }>;

export function readPendingPluginChangeDecision(change: unknown): PendingPluginChangeDecision | null {
    if (!isRecord(change)) return null;
    const parsed = PluginChangePendingReviewResultSchema.safeParse(change);
    if (!parsed.success) return null;
    return parsed.data.kind === 'sourceRootReviewRequired'
        ? {
            kind: 'sourceRootReviewRequired',
            sourceRootReview: {
                pendingChangeId: parsed.data.pendingChangeId,
                review: parsed.data.review,
            },
        }
        : {
            kind: 'reviewRequired',
            installationReview: {
                pendingChangeId: parsed.data.pendingChangeId,
                review: parsed.data.review,
            },
        };
}

/** The daemon-issued id of whichever decision this change is currently at. */
export function readPendingPluginChangeDecisionId(decision: PendingPluginChangeDecision): string {
    return decision.kind === 'sourceRootReviewRequired'
        ? decision.sourceRootReview.pendingChangeId
        : decision.installationReview.pendingChangeId;
}

/**
 * The three outcomes `tool.plugins#develop` can hand back for a present user to
 * decide. `develop` has no caller-known plugin id — the daemon derives it from
 * the source root only after the root is trusted — so this reader keys on the
 * action and never on an expected identity.
 */
export type PluginDevelopChange =
    | PendingPluginChangeDecision
    | Readonly<{ kind: 'committed' }>;

export function readPluginDevelopChange(value: unknown): PluginDevelopChange | null {
    if (!isRecord(value) || value.action !== 'develop' || !isRecord(value.change)) return null;
    const decision = readPendingPluginChangeDecision(value.change);
    if (decision) return decision;
    return value.change.kind === 'committed' ? { kind: 'committed' } : null;
}

/**
 * One entry of the daemon's outstanding-decision enumeration.
 *
 * `applying` is listed rather than hidden: a change that is mid-apply is still
 * this user's change, and silently omitting it would make a decision they just
 * made look like it vanished.
 */
export type PendingPluginChangeListing =
    | PendingPluginChangeDecision
    | Readonly<{ kind: 'applying'; pendingChangeId: string }>;

export function readPendingPluginChangeListing(value: unknown): PendingPluginChangeListing | null {
    if (!isRecord(value)) return null;
    if (value.kind === 'applying') {
        const pendingChangeId = readNonEmptyString(value.pendingChangeId);
        return pendingChangeId && hasOnlyKeys(value, ['kind', 'pendingChangeId'])
            ? { kind: 'applying', pendingChangeId }
            : null;
    }
    return readPendingPluginChangeDecision(value);
}

export function readPendingPluginChangeListingId(entry: PendingPluginChangeListing): string {
    return entry.kind === 'applying' ? entry.pendingChangeId : readPendingPluginChangeDecisionId(entry);
}

/**
 * The by-id rejoin, projected verbatim from the daemon change owner.
 *
 * A listing snapshot is a projection that can be minutes old. Before a user is
 * asked to approve anything, the change is re-read at its owner, which is the
 * only place that can say the honest arms: still applying, already expired, or
 * the daemon that held it is gone.
 */
export type PendingPluginChangeStatus =
    | PendingPluginChangeDecision
    | Readonly<{ kind: 'applying'; pendingChangeId: string }>
    | Readonly<{ kind: 'terminal'; pendingChangeId: string; outcome: string; pluginId: string | null }>
    | Readonly<{ kind: 'expired' }>
    | Readonly<{ kind: 'daemonUnavailable' }>;

export function readPendingPluginChangeStatus(result: unknown): PendingPluginChangeStatus | null {
    if (!isRecord(result) || result.action !== 'changeStatus' || !isRecord(result.status)) return null;
    const status = result.status;
    const decision = readPendingPluginChangeDecision(status);
    if (decision) return decision;
    if (status.kind === 'expired' || status.kind === 'daemonUnavailable') return { kind: status.kind };
    const pendingChangeId = readNonEmptyString(status.pendingChangeId);
    if (!pendingChangeId) return null;
    if (status.kind === 'applying') return { kind: 'applying', pendingChangeId };
    if (status.kind !== 'terminal' || !isRecord(status.result)) return null;
    const outcome = readNonEmptyString(status.result.kind);
    if (!outcome) return null;
    // The terminal result names the affected plugin when the daemon knows it,
    // so a terminal `committed`/`outcomeUnknown` answer can be reconciled
    // against that exact installed record instead of shown as a bare failure.
    return {
        kind: 'terminal',
        pendingChangeId,
        outcome,
        pluginId: readNonEmptyString(status.result.pluginId),
    };
}

/**
 * Reads the daemon's bare `reviewRequired` change through the one cross-process
 * review schema owned by `@happier-dev/protocol/marketplace/internal` — the
 * same schema the daemon projects and the CLI control client parses. Both the
 * capability-invoke envelope and the follow-up returned by a source-root trust
 * decision carry the identical change shape, so they share this one reader.
 */
export function readPluginInstallationReviewChange(
    change: unknown,
    expectedPluginId: string | null,
): PendingPluginChangeReview | null {
    if (!isRecord(change) || change.kind !== 'reviewRequired') return null;
    const parsed = PluginChangePendingReviewResultSchema.safeParse(change);
    if (!parsed.success || parsed.data.kind !== 'reviewRequired') return null;
    if (expectedPluginId !== null && parsed.data.review.pluginId !== expectedPluginId) return null;
    return {
        pendingChangeId: parsed.data.pendingChangeId,
        review: parsed.data.review,
    };
}

export function readPendingPluginChangeReview(
    value: unknown,
    action: 'install' | 'update',
    expectedPluginId: string,
): PendingPluginChangeReview | null {
    if (
        !isRecord(value)
        || value.action !== action
        || value.pluginId !== expectedPluginId
        || !isRecord(value.change)
    ) return null;
    return readPluginInstallationReviewChange(value.change, expectedPluginId);
}

export function readPluginChangeKind(
    value: unknown,
    action: PluginMarketplaceActionRequest['method'],
    expectedPluginId: string,
): string | null {
    if (
        !isRecord(value)
        || value.action !== action
        || value.pluginId !== expectedPluginId
        || !isRecord(value.change)
    ) return null;
    return readNonEmptyString(value.change.kind);
}

type MarketplaceCapabilitySnapshot = Readonly<{
    response: {
        protocolVersion: 1;
        results: Partial<Record<CapabilityId, Readonly<{
            ok: true;
            checkedAt: number;
            data?: {
                installedPlugins?: readonly InstalledPluginEntry[];
                developmentActions?: Readonly<{ create: boolean; develop?: boolean }>;
                developmentSources?: readonly Readonly<{
                    pluginId: string;
                    sourceRootPath: string;
                    watch: Readonly<{ state: 'configured' }>;
                    reload: Readonly<{
                        state: 'clear' | 'attention';
                        diagnostics: readonly InstalledPluginDiagnostic[];
                    }>;
                    actions: Readonly<{ test: boolean; pack: boolean }>;
                }>[];
                /**
                 * Daemon-owned outstanding decisions, projected verbatim. A
                 * machine whose snapshot predates the enumeration reports
                 * nothing, so the section stays absent instead of claiming
                 * there is nothing to decide.
                 */
                pendingChanges?: readonly unknown[];
            } | null;
        }>>>;
    };
}>;

/**
 * The two operation ceilings derived from one current daemon capability fact.
 *
 * Source and npm-registry administration call their exact daemon RPCs and do
 * not consume the contribution-registry projection. Plugin lifecycle and
 * discovery do consume that projection, so they retain the stronger ceiling.
 * Keeping both answers here prevents individual screens from independently
 * deciding what a loading or failed projection means.
 */
export function resolvePluginDaemonOperationsAvailability(params: Readonly<{
    hasExactExecutionTarget: boolean;
    daemonTransportOnline: boolean;
    capabilityStateIsCurrent: boolean;
    capabilityState: ReturnType<typeof useMachineCapabilitiesCache>['state'];
    projectionPhase: DaemonMergedProjectionPhase;
}>): Readonly<{
    administration: boolean;
    projection: boolean;
}> {
    const snapshot = params.capabilityState.status === 'loaded'
        ? params.capabilityState.snapshot
        : null;
    const toolPlugins = snapshot
        ? (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID]
        : null;
    const administration = params.hasExactExecutionTarget
        && params.daemonTransportOnline
        && params.capabilityStateIsCurrent
        && toolPlugins?.ok === true;
    return {
        administration,
        projection: administration && params.projectionPhase === 'ready',
    };
}

export function readInstalledPlugins(
    state: ReturnType<typeof useMachineCapabilitiesCache>['state'],
): readonly InstalledPluginEntry[] {
    const snapshot = state.status === 'loaded' || state.status === 'loading' || state.status === 'error'
        ? state.snapshot
        : null;
    if (!snapshot) return [];

    const toolPlugins = (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID];
    if (!toolPlugins?.ok || !toolPlugins.data || typeof toolPlugins.data !== 'object') return [];

    const installedPlugins = toolPlugins.data.installedPlugins;
    return Array.isArray(installedPlugins) ? installedPlugins : [];
}

export function readDevelopmentPlugins(
    state: ReturnType<typeof useMachineCapabilitiesCache>['state'],
    installedPlugins: readonly InstalledPluginEntry[],
): readonly DevelopmentPluginEntry[] {
    const snapshot = state.status === 'loaded' || state.status === 'loading' || state.status === 'error'
        ? state.snapshot
        : null;
    if (!snapshot) return [];
    const toolPlugins = (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID];
    const developmentSources = toolPlugins?.ok && toolPlugins.data && typeof toolPlugins.data === 'object'
        ? toolPlugins.data.developmentSources
        : null;
    if (!Array.isArray(developmentSources)) return [];

    const installedById = new Map(installedPlugins.map((entry) => [entry.pluginId, entry] as const));
    return developmentSources.flatMap((source) => {
        const installed = installedById.get(source.pluginId);
        return installed ? [{ ...source, installed }] : [];
    });
}

/**
 * The changes this machine's daemon is still waiting on a present user for.
 *
 * A change an Agent prepared has no caller left to hand its issued id to, so
 * this read is the only way it becomes visible in the app at all. Entries the
 * app cannot fully type are dropped rather than shown: a user must never be
 * asked to approve a payload their client could not read.
 */
export function readPendingPluginChanges(
    state: ReturnType<typeof useMachineCapabilitiesCache>['state'],
): readonly PendingPluginChangeListing[] {
    const snapshot = state.status === 'loaded' || state.status === 'loading' || state.status === 'error'
        ? state.snapshot
        : null;
    if (!snapshot) return [];
    const toolPlugins = (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID];
    const pendingChanges = toolPlugins?.ok && toolPlugins.data && typeof toolPlugins.data === 'object'
        ? toolPlugins.data.pendingChanges
        : null;
    if (!Array.isArray(pendingChanges)) return [];
    return pendingChanges.flatMap((entry) => {
        const listing = readPendingPluginChangeListing(entry);
        return listing ? [listing] : [];
    });
}

export function readDevelopmentCreateAvailable(
    state: ReturnType<typeof useMachineCapabilitiesCache>['state'],
): boolean {
    const snapshot = state.status === 'loaded' || state.status === 'loading' || state.status === 'error'
        ? state.snapshot
        : null;
    if (!snapshot) return false;
    const toolPlugins = (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID];
    return toolPlugins?.ok === true
        && toolPlugins.data !== null
        && typeof toolPlugins.data === 'object'
        && toolPlugins.data.developmentActions?.create === true;
}

/**
 * Whether this machine's daemon can adopt a local folder as a development
 * source. It fails closed: a machine whose capability snapshot predates the
 * `develop` action advertises nothing, and the affordance stays disabled rather
 * than sending a method the daemon would reject.
 */
export function readDevelopmentSourceInstallAvailable(
    state: ReturnType<typeof useMachineCapabilitiesCache>['state'],
): boolean {
    const snapshot = state.status === 'loaded' || state.status === 'loading' || state.status === 'error'
        ? state.snapshot
        : null;
    if (!snapshot) return false;
    const toolPlugins = (snapshot as MarketplaceCapabilitySnapshot).response.results[MARKETPLACE_CAPABILITY_ID];
    return toolPlugins?.ok === true
        && toolPlugins.data !== null
        && typeof toolPlugins.data === 'object'
        && toolPlugins.data.developmentActions?.develop === true;
}

/**
 * Reads the deterministic scaffold result the canonical `create` action
 * returns. The returned source root is the only authoritative answer for
 * where the scaffolded plugin now lives; a caller that re-derived the folder
 * it typed into a prompt could disagree with what the daemon actually created.
 */
export function readPluginCreateResult(value: unknown): Readonly<{ pluginId: string; sourceRootPath: string }> | null {
    if (!isRecord(value) || value.action !== 'create') return null;
    const pluginId = readNonEmptyString(value.pluginId);
    const sourceRootPath = readNonEmptyString(value.sourceRootPath);
    return pluginId !== null && sourceRootPath !== null
        ? { pluginId, sourceRootPath }
        : null;
}

/**
 * What a listed pending change is asking for, in the user's own terms. The
 * locator and the package identity are the whole security payload of the two
 * decisions, so both are shown verbatim rather than summarised away.
 */
export function formatPendingPluginChangeTitle(entry: PendingPluginChangeListing): string {
    if (entry.kind === 'applying') return t('settingsPlugins.pendingChangeApplying');
    return entry.kind === 'sourceRootReviewRequired'
        ? t('settingsPlugins.developmentTrustSourceRootTitle')
        : t('settingsPlugins.marketplaceInstallReviewTitle', {
            name: entry.installationReview.review.displayName,
            version: entry.installationReview.review.version,
        });
}

export function formatPendingPluginChangeSubtitle(entry: PendingPluginChangeListing): string {
    if (entry.kind === 'applying') return entry.pendingChangeId;
    return entry.kind === 'sourceRootReviewRequired'
        ? t('settingsPlugins.pendingChangeSourceRootSubtitle', {
            path: entry.sourceRootReview.review.source.locator,
        })
        : t('settingsPlugins.pendingChangeInstallSubtitle', {
            pluginId: entry.installationReview.review.pluginId,
            source: entry.installationReview.review.source.locator,
        });
}

export function formatCatalogEntryVersion(version: string | null): string | undefined {
    return version ?? undefined;
}

export function formatInstalledSubtitle(entry: InstalledPluginEntry): string {
    const diagnostics = [...entry.diagnostics, ...entry.compatibility.diagnostics];
    const parts = [
        entry.enabled ? t('common.enabled') : t('common.disabled'),
        `${entry.source.kind}: ${entry.source.locator}`,
    ];
    if (entry.compatibility.status !== 'compatible') {
        parts.push(entry.compatibility.status);
    }
    if (diagnostics.length > 0) {
        parts.push(diagnostics[0].message);
    }
    return parts.join(' | ');
}

export function formatDevelopmentPluginSubtitle(entry: DevelopmentPluginEntry): string {
    const parts = [
        entry.installed.pluginId,
        entry.installed.enabled ? t('common.enabled') : t('common.disabled'),
        t('settingsPlugins.developmentSourcePathLabel', { path: entry.sourceRootPath }),
    ];
    if (entry.installed.compatibility.status !== 'compatible') {
        parts.push(entry.installed.compatibility.status);
    }
    parts.push(...entry.reload.diagnostics.map((diagnostic) => diagnostic.message));
    return parts.join(' | ');
}
