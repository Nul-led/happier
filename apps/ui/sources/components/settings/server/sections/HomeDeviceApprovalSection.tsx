import * as React from 'react';
import { createHomeLoginRequesterFingerprintV1 } from '@happier-dev/protocol';
import { Platform, StyleSheet, View } from 'react-native';

import {
    decideHomeDeviceApproval,
    listHomeDeviceApprovals,
    type HomeDeviceApprovalDecision,
    type HomeDeviceApprovalListItem,
    type HomeDeviceApprovalTarget,
} from '@/auth/approval/homeDeviceApprovalClient';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
} from '@/auth/pairing/pairingPresentation';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import {
    buildHomeConnectionDescriptorForProfile,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import {
    cancelPendingPreferredHomeEnrollment,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
    subscribePendingPreferredHomeEnrollment,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import type { HomeLoginContinuationResult } from '@/sync/ops/accountDirectory/homeLoginApproval';
import { t } from '@/text';
import {
    useAccountDirectoryActivePolling,
    type AccountDirectoryActivePollingOutcome,
} from '@/sync/ops/accountDirectory/useAccountDirectoryActivePolling';

type PendingApproval = Readonly<{
    home: ServerProfile;
    approval: HomeDeviceApprovalListItem;
}>;

type LoadState =
    | Readonly<{ kind: 'loading'; items: readonly PendingApproval[] }>
    | Readonly<{ kind: 'ready'; items: readonly PendingApproval[] }>
    | Readonly<{ kind: 'error'; items: readonly PendingApproval[] }>;

type StatusAnnouncement = Readonly<{
    revision: number;
    text: string;
}>;

type ApprovalLoadMode = 'interactive' | 'poll';

function approvalSnapshotKey(items: readonly PendingApproval[]): string {
    return items
        .map(({ home, approval }) => `${home.id}:${approval.approvalId}`)
        .sort()
        .join('|');
}

function HomeApprovalAccessibilityStatus({ announcement }: Readonly<{
    announcement: StatusAnnouncement;
}>) {
    const lastIosRevisionRef = React.useRef<number | null>(null);
    React.useEffect(() => {
        if (
            Platform.OS !== 'ios'
            || lastIosRevisionRef.current === announcement.revision
        ) {
            return;
        }
        lastIosRevisionRef.current = announcement.revision;
        announceAccessibilityMessage(announcement.text);
    }, [announcement]);

    if (Platform.OS === 'ios') return null;
    return (
        <View
            testID="settings.server.homeApprovals.status"
            accessible
            accessibilityLabel={announcement.text}
            accessibilityLiveRegion="polite"
            pointerEvents="none"
            style={styles.accessibilityStatus}
            {...({
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            } as Record<string, unknown>)}
        >
            <Text key={announcement.revision}>{announcement.text}</Text>
        </View>
    );
}

function pendingEnrollmentResultAnnouncement(
    homeName: string,
    result: HomeLoginContinuationResult | null | void,
): string {
    const prefix = `${homeName}. `;
    if (!result || result.kind === 'failed' || result.kind === 'transport_unavailable') {
        return `${prefix}${t('errors.operationFailed')}. ${t('common.retry')}`;
    }
    if (result.kind === 'enrolled') return `${prefix}${t('connect.homeAddedPreservedFocusBody')}`;
    if (result.kind === 'approval_required') return `${prefix}${t('connect.waitingForApproval')}`;
    if (result.kind === 'rejected') return `${prefix}${t('connect.pairingRejectedBody')}`;
    if (result.kind === 'expired') return `${prefix}${t('approvals.status.expired')}. ${t('connect.startAgain')}`;
    return `${prefix}${t('approvals.status.canceled')}`;
}

const styles = StyleSheet.create({
    accessibilityStatus: {
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
    },
});

async function withHomeApprovalTarget<T>(
    home: ServerProfile,
    unavailable: T,
    operation: (target: HomeDeviceApprovalTarget) => Promise<T>,
): Promise<T> {
    const descriptor = buildHomeConnectionDescriptorForProfile(home);
    if (!descriptor) return unavailable;
    const credentials = await TokenStorage.getCredentialsForServerUrl(
        descriptor.canonicalServerUrl,
        { serverId: descriptor.homeServerIdentityId },
    ).catch(() => null);
    if (!credentials?.token) return unavailable;
    const resolution = await resolveHomeEnrollmentTransport(descriptor, {
        verification: { kind: 'authenticated', token: credentials.token },
    });
    if (!resolution.ok) return unavailable;
    const { transport } = resolution;
    try {
        return await operation({ transport, credentials });
    } finally {
        await transport.close();
    }
}

export function HomeDeviceApprovalSection({ homes }: Readonly<{ homes: readonly ServerProfile[] }>) {
    const [state, setState] = React.useState<LoadState>({ kind: 'loading', items: [] });
    const [busyKeys, setBusyKeys] = React.useState<readonly string[]>([]);
    const [decisionErrorKeys, setDecisionErrorKeys] = React.useState<readonly string[]>([]);
    const [announcement, setAnnouncement] = React.useState<StatusAnnouncement>({
        revision: 0,
        text: t('common.loading'),
    });
    const mountedRef = React.useRef(false);
    const approvalItemsRef = React.useRef<readonly PendingApproval[]>([]);
    const approvalSnapshotKeyRef = React.useRef<string | null>(null);
    const approvalRefreshPromiseRef = React.useRef<Promise<AccountDirectoryActivePollingOutcome> | null>(null);
    const pendingEnrollment = React.useSyncExternalStore(
        subscribePendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
    );
    const publishAnnouncement = React.useCallback((text: string) => {
        if (!mountedRef.current) return;
        setAnnouncement((current) => ({ revision: current.revision + 1, text }));
    }, []);

    const load = React.useCallback((mode: ApprovalLoadMode = 'interactive'): Promise<AccountDirectoryActivePollingOutcome> => {
        const inFlight = approvalRefreshPromiseRef.current;
        if (inFlight) return inFlight;

        let operation: Promise<AccountDirectoryActivePollingOutcome>;
        operation = (async () => {
            if (mode === 'interactive' && mountedRef.current) {
                setState((current) => ({ kind: 'loading', items: current.items }));
            }
            try {
                const results = await Promise.all(homes.map(async (home) => ({
                    home,
                    result: await withHomeApprovalTarget(
                        home,
                        { ok: false, reason: 'request_failed', status: 0 } as const,
                        listHomeDeviceApprovals,
                    ),
                })));
                if (!mountedRef.current) return 'success';

                const failed = results.some(({ result }) => !result.ok && result.reason !== 'unauthorized');
                if (failed && mode === 'poll') return 'transient';

                const items = results.flatMap(({ home, result }) => result.ok
                    ? result.items.map((approval) => ({ home, approval }))
                    : []);
                const nextSnapshotKey = approvalSnapshotKey(items);
                const changed = nextSnapshotKey !== approvalSnapshotKeyRef.current;
                if (mode === 'poll' && !changed) return 'success';

                approvalItemsRef.current = items;
                approvalSnapshotKeyRef.current = failed ? null : nextSnapshotKey;
                setState({ kind: failed ? 'error' : 'ready', items });
                publishAnnouncement(
                    failed
                        ? t('approvals.loadError')
                        : items.length === 0
                            ? t('inbox.emptyDescription')
                            : `${t('approvals.title')}: ${items.map(({ home }) => home.name).join(', ')}`,
                );
                return failed ? 'transient' : 'success';
            } finally {
                if (approvalRefreshPromiseRef.current === operation) {
                    approvalRefreshPromiseRef.current = null;
                }
            }
        })();
        approvalRefreshPromiseRef.current = operation;
        return operation;
    }, [homes, publishAnnouncement]);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    React.useEffect(() => {
        void load();
    }, [load]);

    const decide = React.useCallback(async (item: PendingApproval, decision: HomeDeviceApprovalDecision) => {
        const key = `${item.home.id}:${item.approval.approvalId}`;
        setBusyKeys((current) => current.includes(key) ? current : [...current, key]);
        setDecisionErrorKeys((current) => current.filter((candidate) => candidate !== key));
        const result = await withHomeApprovalTarget(
            item.home,
            { ok: false, reason: 'request_failed', status: 0 } as const,
            (target) => decideHomeDeviceApproval(target, item.approval.approvalId, decision),
        );
        setBusyKeys((current) => current.filter((candidate) => candidate !== key));
        if (!result.ok) {
            if (result.reason === 'already_decided') {
                setDecisionErrorKeys((current) => current.filter((candidate) => candidate !== key));
                await load();
                return;
            }
            setDecisionErrorKeys((current) => current.includes(key) ? current : [...current, key]);
            publishAnnouncement(`${t('approvals.decisionError')}: ${item.home.name}`);
            return;
        }
        setDecisionErrorKeys((current) => current.filter((candidate) => candidate !== key));
        const remainingItems = approvalItemsRef.current.filter((candidate) => (
            candidate.approval.approvalId !== item.approval.approvalId
            || candidate.home.id !== item.home.id
        ));
        approvalItemsRef.current = remainingItems;
        approvalSnapshotKeyRef.current = approvalSnapshotKey(remainingItems);
        setState({ kind: 'ready', items: remainingItems });
        publishAnnouncement(`${t(`approvals.status.${decision === 'approve' ? 'approved' : 'rejected'}`)}: ${item.home.name}`);
    }, [load, publishAnnouncement]);

    const runPendingEnrollmentOperation = React.useCallback(async (
        homeName: string,
        operationKind: 'resume' | 'cancel',
        operation: () => Promise<HomeLoginContinuationResult | null | void>,
    ) => {
        const pendingKey = 'pending-enrollment';
        setBusyKeys((current) => current.includes(pendingKey) ? current : [...current, pendingKey]);
        try {
            const result = await operation();
            publishAnnouncement(
                operationKind === 'cancel'
                    ? `${homeName}. ${t('approvals.status.canceled')}`
                    : pendingEnrollmentResultAnnouncement(homeName, result),
            );
        } catch {
            publishAnnouncement(`${homeName}. ${t('errors.operationFailed')}. ${t('common.retry')}`);
        } finally {
            setBusyKeys((current) => current.filter((key) => key !== pendingKey));
        }
    }, [publishAnnouncement]);
    const pendingEnrollmentHome = pendingEnrollment
        ? homes.find((candidate) => (
            candidate.serverIdentityId === pendingEnrollment.homeServerIdentityId
            || (candidate.legacyServerIds ?? []).includes(pendingEnrollment.homeServerIdentityId)
        )) ?? null
        : null;
    const pendingEnrollmentName = pendingEnrollmentHome?.name
        ?? pendingEnrollment?.homeServerIdentityId
        ?? '';
    const pendingEnrollmentDescriptor = pendingEnrollmentHome
        ? buildHomeConnectionDescriptorForProfile(pendingEnrollmentHome)
        : null;
    const pendingEnrollmentTarget = pendingEnrollmentDescriptor
        ? formatHomeEnrollmentTargetLabel(pendingEnrollmentDescriptor)
        : null;
    const pendingEnrollmentExpiry = pendingEnrollment
        ? formatEnrollmentExpiry(pendingEnrollment.expiresAtMs)
        : '';
    const pendingEnrollmentBusy = busyKeys.includes('pending-enrollment');

    const poll = React.useCallback(async (): Promise<AccountDirectoryActivePollingOutcome> => {
        try {
            const loadOutcome = await load('poll');
            if (!pendingEnrollment) return loadOutcome;
            const result = await resumePendingPreferredHomeEnrollment();
            if (!mountedRef.current || !result || result.kind === 'approval_required') return loadOutcome;
            publishAnnouncement(pendingEnrollmentResultAnnouncement(pendingEnrollmentName, result));
            return result.kind === 'transport_unavailable' ? 'transient' : loadOutcome;
        } catch {
            // The visible pending card and manual Retry remain available. The next
            // active-screen cadence tick may retry through the same continuation owner.
            return 'transient';
        }
    }, [load, pendingEnrollment, pendingEnrollmentName, publishAnnouncement]);
    useAccountDirectoryActivePolling(poll);

    const pendingEnrollmentGroup = pendingEnrollment ? (
        <ItemGroup title={t('common.home')}>
            <Item
                testID="settings.server.homeEnrollment.pending"
                title={pendingEnrollmentName}
                subtitle={[
                    pendingEnrollmentTarget,
                    t('connect.waitingForApproval'),
                    `${t('connect.expiresAtLabel')}: ${pendingEnrollmentExpiry}`,
                ].filter((value): value is string => typeof value === 'string').join(' · ')}
                accessibilityLabel={`${pendingEnrollmentName}. ${t('connect.waitingForApproval')}. ${t('connect.expiresAtLabel')}: ${pendingEnrollmentExpiry}`}
                mode="info"
                showChevron={false}
            />
            <Item
                testID="settings.server.homeEnrollment.pending.retry"
                title={t('common.retry')}
                accessibilityLabel={`${t('common.retry')}: ${pendingEnrollmentName}`}
                disabled={pendingEnrollmentBusy}
                loading={pendingEnrollmentBusy}
                onPress={() => void runPendingEnrollmentOperation(
                    pendingEnrollmentName,
                    'resume',
                    resumePendingPreferredHomeEnrollment,
                )}
            />
            <Item
                testID="settings.server.homeEnrollment.pending.cancel"
                title={t('common.cancel')}
                accessibilityLabel={`${t('common.cancel')}: ${pendingEnrollmentName}`}
                disabled={pendingEnrollmentBusy}
                onPress={() => void runPendingEnrollmentOperation(
                    pendingEnrollmentName,
                    'cancel',
                    cancelPendingPreferredHomeEnrollment,
                )}
            />
        </ItemGroup>
    ) : null;

    const renderSection = (content: React.ReactNode) => (
        <>
            <HomeApprovalAccessibilityStatus announcement={announcement} />
            {pendingEnrollmentGroup}
            {content}
        </>
    );

    if (state.kind === 'loading' && state.items.length === 0) {
        return renderSection(
            <ItemGroup title={t('approvals.title')}>
                    <Item
                        testID="settings.server.homeApprovals.loading"
                        title={t('common.loading')}
                        loading
                        mode="info"
                        showChevron={false}
                    />
            </ItemGroup>,
        );
    }

    if (state.kind === 'error' && state.items.length === 0) {
        return renderSection(
            <ItemGroup title={t('approvals.title')}>
                    <Item
                        testID="settings.server.homeApprovals.error"
                        title={t('approvals.loadError')}
                        subtitle={t('common.retry')}
                        accessibilityLabel={t('common.retry')}
                        onPress={() => void load()}
                    />
            </ItemGroup>,
        );
    }

    if (state.items.length === 0) {
        return renderSection(null);
    }

    return renderSection(
        <ItemGroup title={t('approvals.title')}>
            {state.items.map((item) => {
                const key = `${item.home.id}:${item.approval.approvalId}`;
                const busy = busyKeys.includes(key);
                const decisionFailed = decisionErrorKeys.includes(key);
                const requesterFingerprint = createHomeLoginRequesterFingerprintV1(
                    item.approval.requesterBoxPublicKeyBase64,
                );
                const approvalExpiresAt = new Date(item.approval.expiresAtMs).toLocaleString();
                const approvalDetails = [
                    item.approval.deviceLabel
                        ? `${t('connect.deviceLabel')}: ${item.approval.deviceLabel}`
                        : t('navigation.linkNewDevice'),
                    `${t('connect.requestKeyFingerprintLabel')}: ${requesterFingerprint}`,
                    `${t('connect.expiresAtLabel')}: ${approvalExpiresAt}`,
                ];
                return (
                    <React.Fragment key={key}>
                        <Item
                            testID={`settings.server.homeApprovals.${item.approval.approvalId}`}
                            title={item.home.name}
                            subtitle={approvalDetails.join(' · ')}
                            accessibilityLabel={`${item.home.name}. ${approvalDetails.join('. ')}`}
                            mode="info"
                            showChevron={false}
                        />
                        {decisionFailed ? (
                            <Item
                                testID={`settings.server.homeApprovals.${item.approval.approvalId}.error`}
                                title={t('errors.operationFailed')}
                                subtitle={t('common.retry')}
                                mode="info"
                                showChevron={false}
                            />
                        ) : null}
                        <Item
                            testID={`settings.server.homeApprovals.${item.approval.approvalId}.approve`}
                            title={t('approvals.approve')}
                            accessibilityLabel={`${t('approvals.approve')}: ${item.home.name}`}
                            disabled={busy}
                            loading={busy}
                            onPress={() => void decide(item, 'approve')}
                        />
                        <Item
                            testID={`settings.server.homeApprovals.${item.approval.approvalId}.reject`}
                            title={t('approvals.reject')}
                            accessibilityLabel={`${t('approvals.reject')}: ${item.home.name}`}
                            disabled={busy}
                            destructive
                            onPress={() => void decide(item, 'reject')}
                        />
                    </React.Fragment>
                );
            })}
        </ItemGroup>,
    );
}
