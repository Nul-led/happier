import type { ApiChangeEntry } from '@/sync/api/types/apiTypes';
import { ACCOUNT_SESSION_FOLLOW_CHANGE_ENTITY_ID } from '@happier-dev/protocol';
import {
    ChangeKindSchema,
    HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1,
    SessionOrganizationChangeHintSchema,
    TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1,
    type ChangeKind,
} from '@happier-dev/protocol/changes';
import {
    SessionDraftChangeHintV1Schema,
    SessionDraftChangeHintV2Schema,
    canonicalSessionDraftAddressV2,
    type SessionDraftAddressV2,
    type SessionDraftChangeHintV1,
    type SessionDraftChangeHintV2,
} from '@happier-dev/protocol';

export type PlannedKvAction =
    | { type: 'none' }
    | { type: 'refresh-feature'; feature: 'todos' }
    | { type: 'bulk-keys'; feature: 'todos'; keys: string[] };

export type PlannedSessionOrganizationAction =
    | { mode: 'none' }
    | {
        mode: 'snapshot';
        assignmentSessionIds: string[];
        folderIds: string[];
        tagIds: string[];
        deletedTagIds: string[];
        orderScopes: Array<{ scopeKind: 'pinned' | 'folder' | 'tag' | 'workspace' | 'group'; scopeKey: string }>;
        includeFolders: boolean;
        includeTags: boolean;
        includeLabels: boolean;
    };

export type UnsupportedChangeMarker = {
    cursor: string;
    kind: string;
    entityId: string;
};

export type PlannedSessionTranscriptRepair = Readonly<{
    sessionId: string;
    minSeq: number;
    messageIds: string[];
}>;

export type ChangeCheckpointDecision =
    | 'critical'
    | 'unsupported';

export type ChangeCheckpointBlockedReason =
    | 'unsupported-kind'
    | 'partial-materialization'
    | 'pending-not-converged';

export type ChangeCheckpointClassification = {
    kind: string;
    cursor: string;
    entityId: string;
    decision: ChangeCheckpointDecision;
    plannerOwner: string;
    snapshotDomain: string | null;
    materializationProof: string | null;
    blockedReason?: ChangeCheckpointBlockedReason;
};

export type ChangeCheckpointClientState = {
    isSessionMessagesLoaded: (sessionId: string) => boolean;
};

export type ChangeCheckpointCoverageEntry = {
    plannerOwner: string;
    snapshotDomain: string;
};

export const CHANGE_CHECKPOINT_COVERAGE = {
    account: { plannerOwner: 'account', snapshotDomain: 'account-settings-profile' },
    automation: { plannerOwner: 'automations', snapshotDomain: 'automations' },
    artifact: { plannerOwner: 'artifacts', snapshotDomain: 'artifacts' },
    feed: { plannerOwner: 'feed', snapshotDomain: 'feed' },
    friends: { plannerOwner: 'friends', snapshotDomain: 'friends' },
    friend_request: { plannerOwner: 'friends', snapshotDomain: 'friends' },
    friend_accepted: { plannerOwner: 'friends', snapshotDomain: 'friends' },
    kv: { plannerOwner: 'kv', snapshotDomain: 'todos' },
    machine: { plannerOwner: 'machines', snapshotDomain: 'machines' },
    machinePool: { plannerOwner: 'machine-pools', snapshotDomain: 'machine-pools' },
    pet: { plannerOwner: 'pets', snapshotDomain: 'pets' },
    savedSecretResource: { plannerOwner: 'saved-secrets', snapshotDomain: 'saved-secret-resource-catalog' },
    pluginDomain: { plannerOwner: 'plugin-domain', snapshotDomain: 'plugin-domain-level-triggered' },
    session: { plannerOwner: 'sessions', snapshotDomain: 'sessions-and-session-messages' },
    share: { plannerOwner: 'sessions', snapshotDomain: 'sessions' },
} satisfies Record<ChangeKind, ChangeCheckpointCoverageEntry>;

export type PlannedChangeActions = {
    changes: ApiChangeEntry[];
    workflowRunIdsToRefresh: string[];
    sessionIdsToCatchUp: string[];
    sessionTranscriptRepairs: PlannedSessionTranscriptRepair[];
    sessionFolderAssignmentSessionIds: string[];
    sessionOrganization: PlannedSessionOrganizationAction;
    unsupportedChanges: UnsupportedChangeMarker[];
    invalidate: {
        sessions: boolean;
        sessionFolderAssignments: boolean;
        machines: boolean;
        machinePools: boolean;
        artifacts: boolean;
        settings: boolean;
        profile: boolean;
        friends: boolean;
        feed: boolean;
        automations: boolean;
        pets: boolean;
        savedSecretResources: boolean;
    };
    kv: PlannedKvAction;
    sessionDraftAddresses?: SessionDraftAddressV2[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const knownChangeKinds = new Set<string>(ChangeKindSchema.options);

function isKnownChangeKind(kind: string): kind is ChangeKind {
    return knownChangeKinds.has(kind);
}

function hasPendingHint(change: ApiChangeEntry): boolean {
    const hint = change.hint;
    return (
        isRecord(hint)
        && (typeof hint.pendingVersion === 'number' || typeof hint.pendingCount === 'number')
    );
}

function hasSessionFolderAssignmentHint(change: ApiChangeEntry): boolean {
    const hint = change.hint;
    return isRecord(hint) && (
        hint.sessionFolderAssignment === true
        || hint.sessionFolderAssignments === true
    );
}

function hasSessionOrganizationHint(change: ApiChangeEntry): boolean {
    return SessionOrganizationChangeHintSchema.safeParse(change.hint).success;
}

function readSessionOrganizationHint(change: ApiChangeEntry) {
    const parsed = SessionOrganizationChangeHintSchema.safeParse(change.hint);
    return parsed.success ? parsed.data : null;
}

export function getChangeSessionDraftHint(change: ApiChangeEntry): SessionDraftChangeHintV1 | SessionDraftChangeHintV2 | null {
    if (change.kind !== 'account') return null;
    const schema = isRecord(change.hint) && change.hint.v === 2
        ? SessionDraftChangeHintV2Schema
        : SessionDraftChangeHintV1Schema;
    const parsed = schema.safeParse(change.hint);
    return parsed.success ? parsed.data : null;
}

function readHintStringArray(change: ApiChangeEntry, key: string): string[] {
    const hint = change.hint;
    if (!isRecord(hint)) return [];
    const value = hint[key];
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
}

function readOrganizationOrderScopes(change: ApiChangeEntry): Array<{ scopeKind: 'pinned' | 'folder' | 'tag' | 'workspace' | 'group'; scopeKey: string }> {
    const hint = change.hint;
    if (!isRecord(hint) || !Array.isArray(hint.orderScopes)) return [];
    const out: Array<{ scopeKind: 'pinned' | 'folder' | 'tag' | 'workspace' | 'group'; scopeKey: string }> = [];
    for (const scope of hint.orderScopes) {
        if (!isRecord(scope)) continue;
        const scopeKind = typeof scope.scopeKind === 'string' ? scope.scopeKind : '';
        const scopeKey = typeof scope.scopeKey === 'string' ? scope.scopeKey.trim() : '';
        if (
            (scopeKind === 'pinned' || scopeKind === 'folder' || scopeKind === 'tag' || scopeKind === 'workspace' || scopeKind === 'group')
            && scopeKey
        ) {
            out.push({ scopeKind, scopeKey });
        }
    }
    return out.sort((left, right) => `${left.scopeKind}:${left.scopeKey}`.localeCompare(`${right.scopeKind}:${right.scopeKey}`));
}

export function getChangeTargetMessageSeq(change: ApiChangeEntry): number | null {
    const hint = change.hint;
    if (!isRecord(hint)) return null;
    const candidate = hint.lastMessageSeq ?? hint.targetMessageSeq;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) return null;
    return Math.trunc(candidate);
}

export function getChangeUpdatedMessageHint(
    change: ApiChangeEntry,
): Readonly<{ seq: number; messageId: string }> | null {
    if (change.kind !== 'session' && change.kind !== 'share') return null;
    const hint = change.hint;
    if (!isRecord(hint)) return null;
    const seq = hint.updatedMessageSeq;
    const messageId = typeof hint.updatedMessageId === 'string' ? hint.updatedMessageId.trim() : '';
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0 || !messageId) return null;
    return { seq: Math.trunc(seq), messageId };
}

function requiresFollowSessionRefresh(change: ApiChangeEntry): boolean {
    return change.kind === 'account' && change.entityId === ACCOUNT_SESSION_FOLLOW_CHANGE_ENTITY_ID;
}

export function changeRequiresSavedSecretCatalogRefresh(change: Pick<ApiChangeEntry, 'kind' | 'entityId' | 'hint'>): boolean {
    const isAccountCurrentnessChange = change.kind === 'account'
        && change.entityId === 'self'
        && (!isRecord(change.hint)
            || Object.keys(change.hint).some((key) => key !== 'settingsVersion'));
    return change.kind === 'savedSecretResource'
        || (change.kind === 'account' && change.entityId === TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1)
        || isAccountCurrentnessChange;
}

export function classifyChangeForCheckpoint(
    change: ApiChangeEntry,
    _clientState: ChangeCheckpointClientState,
): ChangeCheckpointClassification {
    const kind = String(change.kind);
    const cursor = String(change.cursor);
    const entityId = String(change.entityId ?? '');

    if (!isKnownChangeKind(kind)) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'unsupported',
            plannerOwner: 'unsupported',
            snapshotDomain: null,
            materializationProof: null,
            blockedReason: 'unsupported-kind',
        };
    }

    const coverage = CHANGE_CHECKPOINT_COVERAGE[kind];

    if (requiresFollowSessionRefresh(change)) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'critical',
            plannerOwner: 'sessions',
            snapshotDomain: 'sessions',
            materializationProof: 'sessions',
        };
    }

    if (kind === 'account' && entityId.startsWith('workflow-run:') && entityId.length > 'workflow-run:'.length) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'critical',
            plannerOwner: 'workflow-runs',
            snapshotDomain: 'workflow-run',
            materializationProof: 'workflow-run',
        };
    }

    if (getChangeSessionDraftHint(change)) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'critical',
            plannerOwner: 'session-drafts',
            snapshotDomain: 'session-drafts',
            materializationProof: 'session-draft',
        };
    }

    if ((kind === 'account' || kind === 'session') && hasSessionOrganizationHint(change)) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'critical',
            plannerOwner: 'session-organization',
            snapshotDomain: 'session-organization',
            materializationProof: 'session-organization',
        };
    }

    if (kind === 'session' || kind === 'share') {
        if (kind === 'session' && hasSessionFolderAssignmentHint(change)) {
            return {
                kind,
                cursor,
                entityId,
                decision: 'critical',
                plannerOwner: 'sessions',
                snapshotDomain: 'session-folder-assignments',
                materializationProof: 'session-folder-assignment-refresh',
            };
        }

        if (hasPendingHint(change)) {
            return {
                kind,
                cursor,
                entityId,
                decision: 'critical',
                plannerOwner: coverage.plannerOwner,
                snapshotDomain: coverage.snapshotDomain,
                materializationProof: 'pending-queue-convergence',
            };
        }

    }

    if (kind === 'account' && hasSessionFolderAssignmentHint(change)) {
        return {
            kind,
            cursor,
            entityId,
            decision: 'critical',
            plannerOwner: 'sessions',
            snapshotDomain: 'session-folder-assignments',
            materializationProof: 'session-folder-assignment-refresh',
        };
    }

    return {
        kind,
        cursor,
        entityId,
        decision: 'critical',
        plannerOwner: coverage.plannerOwner,
        snapshotDomain: coverage.snapshotDomain,
        materializationProof: coverage.snapshotDomain,
    };
}

export function planSyncActionsFromChanges(changes: ApiChangeEntry[]): PlannedChangeActions {
    const sessionIds = new Set<string>();
    const sessionTranscriptRepairs = new Map<string, { minSeq: number; messageIds: Set<string> }>();
    const sessionFolderAssignmentSessionIds = new Set<string>();
    const organizationAssignmentSessionIds = new Set<string>();
    const organizationFolderIds = new Set<string>();
    const organizationTagIds = new Set<string>();
    const organizationDeletedTagIds = new Set<string>();
    const organizationOrderScopes = new Map<string, { scopeKind: 'pinned' | 'folder' | 'tag' | 'workspace' | 'group'; scopeKey: string }>();
    const unsupportedChanges: UnsupportedChangeMarker[] = [];
    let invalidateSessions = false;
    let invalidateSessionFolderAssignments = false;
    let organizationRefresh = false;
    let organizationIncludeFolders = false;
    let organizationIncludeTags = false;
    let organizationIncludeLabels = false;
    let invalidateMachines = false;
    let invalidateMachinePools = false;
    let invalidateArtifacts = false;
    let invalidateSettings = false;
    let invalidateProfile = false;
    let invalidateFriends = false;
    let invalidateFeed = false;
    let invalidateAutomations = false;
    let invalidatePets = false;
    let invalidateSavedSecretResources = false;

    let kvFull = false;
    const kvKeys = new Set<string>();
    const sessionDraftAddresses = new Map<string, SessionDraftAddressV2>();
    const workflowRunIdsToRefresh = new Set<string>();

    for (const change of changes) {
        const kind = change.kind;
        if (!isKnownChangeKind(String(kind))) {
            unsupportedChanges.push({
                cursor: String(change.cursor),
                kind: String(kind),
                entityId: String(change.entityId ?? ''),
            });
            continue;
        }

        const sessionDraftHint = getChangeSessionDraftHint(change);
        if (sessionDraftHint) {
            sessionDraftAddresses.set(canonicalSessionDraftAddressV2(sessionDraftHint.address), sessionDraftHint.address);
            continue;
        }

        if (kind === 'session' || kind === 'share') {
            if (kind === 'session' && hasSessionFolderAssignmentHint(change)) {
                if (typeof change.entityId === 'string' && change.entityId.length > 0) {
                    sessionFolderAssignmentSessionIds.add(change.entityId);
                    organizationAssignmentSessionIds.add(change.entityId);
                }
                for (const folderId of readHintStringArray(change, 'folderIds')) organizationFolderIds.add(folderId);
                invalidateSessionFolderAssignments = true;
                organizationRefresh = true;
                continue;
            }
            if (kind === 'session' && hasSessionOrganizationHint(change)) {
                const organizationHint = readSessionOrganizationHint(change);
                organizationRefresh = true;
                if (typeof change.entityId === 'string' && change.entityId.length > 0) {
                    organizationAssignmentSessionIds.add(change.entityId);
                }
                for (const sessionId of readHintStringArray(change, 'sessionIds')) organizationAssignmentSessionIds.add(sessionId);
                for (const folderId of readHintStringArray(change, 'folderIds')) organizationFolderIds.add(folderId);
                for (const tagId of readHintStringArray(change, 'tagIds')) organizationTagIds.add(tagId);
                for (const tagId of organizationHint?.deletedTagIds ?? []) organizationDeletedTagIds.add(tagId);
                for (const scope of readOrganizationOrderScopes(change)) organizationOrderScopes.set(`${scope.scopeKind}:${scope.scopeKey}`, scope);
                const hintScope = isRecord(change.hint) && typeof change.hint.scope === 'string' ? change.hint.scope : '';
                // A standing change moves rows between the attention band and the rest of the
                // list exactly the way a pin change moves them in and out of the pinned group,
                // so the session list has to be re-read for both.
                if (hintScope === 'pins' || hintScope === 'attentionStandings') {
                    invalidateSessions = true;
                }
                organizationIncludeFolders = organizationIncludeFolders || hintScope === 'folders' || hintScope === 'folderAssignments';
                organizationIncludeTags = organizationIncludeTags || hintScope === 'tags' || hintScope === 'tagAssignments';
                organizationIncludeLabels = organizationIncludeLabels || hintScope === 'labels';
                continue;
            }
            invalidateSessions = true;
            if (typeof change.entityId === 'string' && change.entityId.length > 0) {
                sessionIds.add(change.entityId);
                const updatedMessage = getChangeUpdatedMessageHint(change);
                if (updatedMessage) {
                    const existing = sessionTranscriptRepairs.get(change.entityId);
                    if (existing) {
                        existing.minSeq = Math.min(existing.minSeq, updatedMessage.seq);
                        existing.messageIds.add(updatedMessage.messageId);
                    } else {
                        sessionTranscriptRepairs.set(change.entityId, {
                            minSeq: updatedMessage.seq,
                            messageIds: new Set([updatedMessage.messageId]),
                        });
                    }
                }
            }
            continue;
        }

        if (kind === 'account') {
            if (changeRequiresSavedSecretCatalogRefresh(change)) {
                invalidateSavedSecretResources = true;
            }
            if (change.entityId.startsWith('workflow-run:')) {
                const runId = change.entityId.slice('workflow-run:'.length);
                if (runId) workflowRunIdsToRefresh.add(runId);
                continue;
            }
            if (change.entityId === ACCOUNT_SESSION_FOLLOW_CHANGE_ENTITY_ID) {
                if (requiresFollowSessionRefresh(change)) invalidateSessions = true;
                continue;
            }
            if (
                change.entityId === TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1
                || change.entityId === HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1
            ) {
                // Scoped snapshot materialization consumes these stable entity
                // IDs before the cursor advances. They are not Account profile
                // or encrypted-settings mutations.
                // Team and Group membership are also authorization inputs for
                // shared Saved Secrets, so retire material at this same wake
                // and let the catalog owner re-observe current grants.
                continue;
            }
            if (
                change.entityId === 'session-folder-assignments'
                || hasSessionFolderAssignmentHint(change)
            ) {
                invalidateSessionFolderAssignments = true;
                organizationRefresh = true;
                for (const folderId of readHintStringArray(change, 'folderIds')) organizationFolderIds.add(folderId);
                continue;
            }
            if (hasSessionOrganizationHint(change)) {
                const organizationHint = readSessionOrganizationHint(change);
                organizationRefresh = true;
                for (const sessionId of readHintStringArray(change, 'sessionIds')) organizationAssignmentSessionIds.add(sessionId);
                for (const folderId of readHintStringArray(change, 'folderIds')) organizationFolderIds.add(folderId);
                for (const tagId of readHintStringArray(change, 'tagIds')) organizationTagIds.add(tagId);
                for (const tagId of organizationHint?.deletedTagIds ?? []) organizationDeletedTagIds.add(tagId);
                for (const scope of readOrganizationOrderScopes(change)) organizationOrderScopes.set(`${scope.scopeKind}:${scope.scopeKey}`, scope);
                const hintScope = isRecord(change.hint) && typeof change.hint.scope === 'string' ? change.hint.scope : '';
                // A standing change moves rows between the attention band and the rest of the
                // list exactly the way a pin change moves them in and out of the pinned group,
                // so the session list has to be re-read for both.
                if (hintScope === 'pins' || hintScope === 'attentionStandings') {
                    invalidateSessions = true;
                }
                organizationIncludeFolders = organizationIncludeFolders || hintScope === 'folders' || hintScope === 'folderAssignments';
                organizationIncludeTags = organizationIncludeTags || hintScope === 'tags' || hintScope === 'tagAssignments';
                organizationIncludeLabels = organizationIncludeLabels || hintScope === 'labels';
                continue;
            }
            invalidateSettings = true;
            invalidateProfile = true;
            continue;
        }

        if (kind === 'machine') {
            invalidateMachines = true;
            continue;
        }

        if (kind === 'machinePool') {
            invalidateMachinePools = true;
            continue;
        }

        if (kind === 'artifact') {
            invalidateArtifacts = true;
            continue;
        }

        if (kind === 'friends' || kind === 'friend_request' || kind === 'friend_accepted') {
            invalidateFriends = true;
            continue;
        }

        if (kind === 'feed') {
            invalidateFeed = true;
            continue;
        }

        if (kind === 'automation') {
            invalidateAutomations = true;
            continue;
        }

        if (kind === 'pet') {
            invalidatePets = true;
            continue;
        }

        if (changeRequiresSavedSecretCatalogRefresh(change)) {
            invalidateSavedSecretResources = true;
            continue;
        }

        if (kind === 'kv') {
            const hint = change.hint;
            if (!isRecord(hint)) {
                kvFull = true;
                continue;
            }
            if (hint.full === true) {
                kvFull = true;
                continue;
            }
            const keys = hint.keys;
            if (Array.isArray(keys)) {
                for (const key of keys) {
                    if (typeof key === 'string' && key.length > 0) {
                        kvKeys.add(key);
                    }
                }
                continue;
            }
            kvFull = true;
            continue;
        }
    }

    const kv: PlannedKvAction = kvFull
        ? { type: 'refresh-feature', feature: 'todos' }
        : kvKeys.size > 0
            ? { type: 'bulk-keys', feature: 'todos', keys: Array.from(kvKeys).sort() }
            : { type: 'none' };

    return {
        changes: [...changes],
        workflowRunIdsToRefresh: [...workflowRunIdsToRefresh].sort(),
        sessionIdsToCatchUp: Array.from(sessionIds).sort(),
        sessionTranscriptRepairs: Array.from(sessionTranscriptRepairs.entries())
            .map(([sessionId, repair]) => ({
                sessionId,
                minSeq: repair.minSeq,
                messageIds: Array.from(repair.messageIds).sort(),
            }))
            .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
        sessionFolderAssignmentSessionIds: Array.from(sessionFolderAssignmentSessionIds).sort(),
        sessionOrganization: organizationRefresh
            ? {
                mode: 'snapshot',
                assignmentSessionIds: Array.from(organizationAssignmentSessionIds).sort(),
                folderIds: Array.from(organizationFolderIds).sort(),
                tagIds: Array.from(organizationTagIds).sort(),
                deletedTagIds: Array.from(organizationDeletedTagIds).sort(),
                orderScopes: Array.from(organizationOrderScopes.values()),
                includeFolders: organizationIncludeFolders,
                includeTags: organizationIncludeTags,
                includeLabels: organizationIncludeLabels,
            }
            : { mode: 'none' },
        unsupportedChanges,
        invalidate: {
            sessions: invalidateSessions,
            sessionFolderAssignments: invalidateSessionFolderAssignments,
            machines: invalidateMachines,
            machinePools: invalidateMachinePools,
            artifacts: invalidateArtifacts,
            settings: invalidateSettings,
            profile: invalidateProfile,
            friends: invalidateFriends,
            feed: invalidateFeed,
            automations: invalidateAutomations,
            pets: invalidatePets,
            savedSecretResources: invalidateSavedSecretResources,
        },
        kv,
        sessionDraftAddresses: [...sessionDraftAddresses.values()].sort((left, right) => (
            canonicalSessionDraftAddressV2(left).localeCompare(canonicalSessionDraftAddressV2(right))
        )),
    };
}

/**
 * Projects the canonical materialization plan onto filtered-list membership.
 *
 * Most membership-changing facts already require the incumbent Sessions refresh.
 * Team/Group changes and tag organization changes are the two strict-query-only
 * additions: released owner/direct Session snapshots do not consume them, while
 * the filtered query does. Keeping the projection here prevents each list consumer
 * from reinterpreting raw AccountChange hints.
 */
export function plannedChangesAffectSessionListQuery(
    planned: PlannedChangeActions,
): boolean {
    if (planned.invalidate.sessions) return true;
    if (
        planned.sessionOrganization.mode === 'snapshot'
        && planned.sessionOrganization.includeTags
    ) {
        return true;
    }
    return planned.changes.some((change) => {
        if (change.kind !== 'account') return false;
        if (
            change.entityId === TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1
            || change.entityId === HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1
        ) return true;
        if (change.entityId !== 'self') return false;

        // Settings writes identify their exact version. Other `self` changes can
        // alter Account/credential currentness used by restricted-Team admission,
        // so an absent or broader hint remains conservative.
        const hint = change.hint;
        return !isRecord(hint)
            || Object.keys(hint).some((key) => key !== 'settingsVersion');
    });
}
