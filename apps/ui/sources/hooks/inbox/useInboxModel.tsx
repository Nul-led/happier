import * as React from 'react';

import { useActivityOverview } from '@/activity/source/useActivityOverview';
import {
    buildInboxSessionPresentation,
    type InboxSessionPresentation,
} from '@/activity/presentation/buildInboxSessionPresentation';
import { isOpenApprovalInboxArtifact } from '@/components/approvals/approvalInboxHeader';
import { executeSessionBulkAction } from '@/components/sessions/actions/sessionBulkActionExecution';
import {
    SESSION_BULK_ACTION_IDS,
    type SessionBulkActionTarget,
} from '@/components/sessions/actions/sessionBulkActionTypes';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    useInboxActionOperations,
} from '@/sync/domains/actionOperations/useActionOperations';
import type { InboxActionOperationEntry } from '@/sync/domains/actionOperations/actionOperationSelectors';
import { actionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';
import { actionOperationAddress } from '@/sync/domains/actionOperations/qualifiedActionOperation';
import {
    areSessionAddressesEqual,
    normalizeSessionAddress,
} from '@/sync/domains/session/sessionAddress';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import { useArtifacts, useFriendsLoaded } from '@/sync/domains/state/storage';
import { sessionSetManualReadStateWithServerScope } from '@/sync/ops';

import { useInboxFriendRequests } from './useInboxFriendRequests';

export type InboxModel = Readonly<{
    source: ReturnType<typeof useActivityOverview>['source'];
    openApprovals: ReturnType<typeof useArtifacts>;
    friendRequests: ReturnType<typeof useInboxFriendRequests>['requests'];
    sessionPresentation: InboxSessionPresentation;
    targetBySessionAddress: ReadonlyMap<string, SessionBulkActionTarget>;
    actionOperationEntries: readonly InboxActionOperationEntry[];
    pendingReadKeys: ReadonlySet<string>;
    markAllPending: boolean;
    isLoading: boolean;
    hasPrimaryAttention: boolean;
    hasContent: boolean;
    showCaughtUp: boolean;
    markRead: (targets: readonly SessionBulkActionTarget[]) => Promise<void>;
    resolveActionOperation: (entry: InboxActionOperationEntry) => void;
}>;

const InboxModelContext = React.createContext<InboxModel | null>(null);

/**
 * The mounted Inbox controller shared by every Inbox surface.
 *
 * It owns one Activity subscription/boundary clock, one presentation, and one
 * exact-address pending ledger. Surfaces only compose layout and navigation;
 * they cannot independently reinterpret attention or mark-read progress.
 */
function useCreateInboxModel(): InboxModel {
    const { source, overview } = useActivityOverview();
    const friends = useInboxFriendRequests();
    const artifacts = useArtifacts();
    const friendsLoaded = useFriendsLoaded();
    const actionOperationEntries = useInboxActionOperations();
    const [pendingReadKeys, setPendingReadKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const pendingReadKeysRef = React.useRef<ReadonlySet<string>>(pendingReadKeys);

    const openApprovals = React.useMemo(
        () => artifacts.filter(isOpenApprovalInboxArtifact),
        [artifacts],
    );
    const sessionPresentation = React.useMemo(
        () => buildInboxSessionPresentation({
            overview,
            resolveMessages: (candidate) => {
                const hydrated = source.sessionsById[candidate.sessionId];
                const hydratedAddress = normalizeSessionAddress(hydrated?.serverId, hydrated?.id);
                if (!areSessionAddressesEqual(hydratedAddress, candidate.address)) return undefined;
                return readStoredSessionMessagesFromStateLike(
                    source.sessionMessagesById?.[candidate.sessionId],
                );
            },
        }),
        [overview, source.sessionMessagesById, source.sessionsById],
    );

    const markAllReadTargets = sessionPresentation.markAllReadTargets;
    const targetBySessionAddress = React.useMemo(
        () => new Map(markAllReadTargets.map((target) => [target.key, target] as const)),
        [markAllReadTargets],
    );
    const isLoading = (
        (friends.visible && !friendsLoaded)
        || (!source.isDataReady && overview.candidates.length === 0)
    );
    const hasPrimaryAttention = openApprovals.length > 0
        || sessionPresentation.sessionsNeedingAttention.length > 0
        || sessionPresentation.readySessions.length > 0
        || friends.requests.length > 0
        || actionOperationEntries.length > 0;
    const showCaughtUp = !isLoading && !hasPrimaryAttention;
    const markAllPending = markAllReadTargets.length > 0
        && markAllReadTargets.every((target) => pendingReadKeys.has(target.key));

    const applyPendingReadKeys = React.useCallback((next: ReadonlySet<string>) => {
        pendingReadKeysRef.current = next;
        setPendingReadKeys(next);
    }, []);

    const markRead = React.useCallback(async (requested: readonly SessionBulkActionTarget[]) => {
        // A row acknowledgement may still be settling when mark-all is pressed.
        // Filter against the shared ledger so an exact Home address is submitted once.
        const targets = requested.filter((target) => !pendingReadKeysRef.current.has(target.key));
        if (targets.length === 0) return;
        const requestedKeys = new Set(targets.map((target) => target.key));
        applyPendingReadKeys(new Set([...pendingReadKeysRef.current, ...requestedKeys]));
        try {
            const result = await executeSessionBulkAction({
                action: { id: SESSION_BULK_ACTION_IDS.markRead },
                targets,
                context: {
                    setManualReadState: async (target, readState) => (
                        await sessionSetManualReadStateWithServerScope(target.sessionId, readState, {
                            serverId: target.serverId,
                        })
                    ),
                },
            });
            if (result.failed.length > 0) {
                Modal.alert(t('common.error'), t('sessionInfo.failedToMarkSessionRead'));
            }
        } catch {
            Modal.alert(t('common.error'), t('sessionInfo.failedToMarkSessionRead'));
        } finally {
            const next = new Set(pendingReadKeysRef.current);
            for (const key of requestedKeys) next.delete(key);
            applyPendingReadKeys(next);
        }
    }, [applyPendingReadKeys]);
    const resolveActionOperation = React.useCallback((entry: InboxActionOperationEntry) => {
        const address = actionOperationAddress(
            entry.operation.serverId,
            entry.operation.snapshot.operationId,
        );
        if (entry.reason === 'status_unavailable') {
            actionOperationStore.dismissUnavailable(address);
            return;
        }
        actionOperationStore.markTerminalSeen(address);
    }, []);

    return React.useMemo(() => ({
        source,
        openApprovals,
        friendRequests: friends.requests,
        sessionPresentation,
        targetBySessionAddress,
        actionOperationEntries,
        pendingReadKeys,
        markAllPending,
        isLoading,
        hasPrimaryAttention,
        hasContent: hasPrimaryAttention,
        showCaughtUp,
        markRead,
        resolveActionOperation,
    }), [
        actionOperationEntries,
        friends.requests,
        hasPrimaryAttention,
        isLoading,
        markAllPending,
        markRead,
        resolveActionOperation,
        openApprovals,
        pendingReadKeys,
        sessionPresentation,
        showCaughtUp,
        source,
        targetBySessionAddress,
    ]);
}

/** Mount once above every simultaneously reachable Inbox surface. */
export function InboxModelProvider(props: Readonly<{ children: React.ReactNode }>) {
    const model = useCreateInboxModel();
    return (
        <InboxModelContext.Provider value={model}>
            {props.children}
        </InboxModelContext.Provider>
    );
}

/**
 * Test/isolated-screen fallback that becomes a no-op beneath the shell owner.
 * The creator hook only mounts in the provider branch, so consumers beneath an
 * existing owner never subscribe twice.
 */
export function InboxModelBoundary(props: Readonly<{ children: React.ReactNode }>) {
    const existing = React.useContext(InboxModelContext);
    if (existing) return <>{props.children}</>;
    return <InboxModelProvider>{props.children}</InboxModelProvider>;
}

export function useInboxModel(): InboxModel {
    const model = React.useContext(InboxModelContext);
    if (!model) {
        throw new Error('useInboxModel must be rendered under InboxModelProvider');
    }
    return model;
}

/** Narrow migration seam for badge hooks that can retain an isolated fallback. */
export function useOptionalInboxModel(): InboxModel | null {
    return React.useContext(InboxModelContext);
}
