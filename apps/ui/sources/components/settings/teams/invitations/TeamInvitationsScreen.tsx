import * as React from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import type {
    TeamInvitationReissueResultV1,
    TeamInvitationRowV1,
} from '@happier-dev/protocol/teams';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { useTeamInvitations } from '@/hooks/teams/useTeamInvitations';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import {
    reissueTeamInvitation,
    revokeTeamInvitation,
} from '@/sync/ops/teams/teamInvitationOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamMutationFailureLabel } from '../teamMutationPresentation';
import { teamInvitationCreatePath } from '../teamsRoutes';
import { TeamLinkDelivery } from '../TeamLinkDelivery';
import { resolveTeamInvitationPresentation } from './teamInvitationPresentation';

const INVITATION_CHUNK_SIZE = 12;

type InvitationVirtualizedSegment = Readonly<{
    key: string;
    items: readonly TeamInvitationRowV1[];
    first: boolean;
    last: boolean;
}>;

const InvitationsList = React.memo(function InvitationsList(props: Readonly<{
    context: TeamSectionContext;
    header?: React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context } = props;
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    /**
     * The bearer produced by a reissue, held only in this screen's memory for
     * the one moment the manager can copy it. It is never persisted, never
     * written to a snapshot, and never read back from a listed row.
     */
    const [freshJoinUrl, setFreshJoinUrl] = React.useState<string | null>(null);
    const reissueRequestIdentity = React.useRef<Readonly<{
        intent: string;
        requestKey: string;
    }> | null>(null);
    const rowActionInFlightRef = React.useRef(false);

    const canManage = context.team.capabilities.manageInvitations;
    const invitations = useTeamInvitations({
        scope: context.scope,
        address: context.address,
        state: null,
        enabled: canManage,
    });
    const hasFocused = React.useRef(false);

    useFocusEffect(React.useCallback(() => {
        if (!hasFocused.current) {
            hasFocused.current = true;
            return;
        }
        void invitations.reload();
    }, [invitations.reload]));

    const publishNotice = React.useCallback((message: string) => {
        setNotice(message);
        announceAccessibilityMessage(message);
    }, []);

    /**
     * This list's mount lifetime, and the whole custody of a reissued bearer.
     *
     * Reissue is live-only: an explicit UI approval keeps the invocation
     * pending through the shared blocking waiter and the replacement link
     * returns to that call alone, because the durable Artifact keeps only the
     * safe projection. Binding the request to this mount is what stops an
     * answer arriving for a Team the person has already left — and a cancelled
     * wait is simply gone, so the only honest offer afterwards is to reissue
     * again.
     */
    const bearerLifetime = React.useRef<AbortController>(new AbortController());
    React.useEffect(() => {
        const lifetime = bearerLifetime.current;
        return () => lifetime.abort();
    }, []);

    /** Presents the replacement this exact live invocation answered with. */
    const settleReissue = React.useCallback((value: TeamInvitationReissueResultV1) => {
        reissueRequestIdentity.current = null;
        // `null` means the bearer went only to the mail boundary — not a failure.
        setFreshJoinUrl(value.joinUrl);
        if (value.joinUrl === null) {
            const delivery = value.replacement.lastEmailDelivery;
            publishNotice(delivery?.status === 'sent'
                ? t('teams.invitations.deliverySent')
                : delivery?.status === 'failed'
                    ? t('teams.invitations.deliveryFailed')
                    : t('teams.invitations.deliveryUnknown'));
        } else {
            announceAccessibilityMessage(t('teams.invitations.reissueNotice'));
        }
        void invitations.reload();
    }, [invitations.reload, publishNotice]);

    // Evaluated once per render so every row in one pass agrees about "now".
    const now = Date.now();

    const invitationSegments = React.useMemo<readonly InvitationVirtualizedSegment[]>(() => {
        const segments: InvitationVirtualizedSegment[] = [];
        for (let start = 0; start < invitations.rows.length; start += INVITATION_CHUNK_SIZE) {
            const items = invitations.rows.slice(start, start + INVITATION_CHUNK_SIZE);
            segments.push({
                key: `invitations:${items[0]!.id}`,
                items,
                first: start === 0,
                last: start + INVITATION_CHUNK_SIZE >= invitations.rows.length,
            });
        }
        return segments;
    }, [invitations.rows]);

    return (
        <VirtualizedList
            testID="team-invitations-virtualized-list"
            data={canManage ? invitationSegments : []}
            keyExtractor={(segment) => segment.key}
            ListHeaderComponent={(
                <>
                    {props.header}
                    {!canManage ? (
                        <ItemGroup footer={t('teams.errors.forbidden')}>
                            <Item testID="team-invitations-forbidden" title={t('homeGovernance.forbiddenTitle')} showChevron={false} />
                        </ItemGroup>
                    ) : null}
                    {/* A reissued bearer is handed over exactly the way a freshly created
                        one is. Offering only Copy here would mean the same secret is
                        deliverable by QR on one screen and not on the other, for no
                        reason a manager could discover. */}
                    {canManage && freshJoinUrl ? (
                        <TeamLinkDelivery
                            url={freshJoinUrl}
                            testIDPrefix="team-invitations-fresh"
                            title={t('teams.invitations.linkRow')}
                            copyLabel={t('teams.invitations.copyLink')}
                            shareLabel={t('teams.invitations.shareLink')}
                            qrAccessibilityLabel={t('teams.invitations.qrLabel')}
                            footer={t('teams.invitations.reissueNotice')}
                        />
                    ) : null}
                    {canManage && invitations.status === 'loading' && invitations.rows.length === 0 ? (
                        <ItemGroup>
                            <Item testID="team-invitations-loading" title={t('teams.tabs.invitations')} loading showChevron={false} />
                        </ItemGroup>
                    ) : null}
                    {canManage && invitations.rows.length === 0 && invitations.status === 'ready' ? (
                        <ItemGroup footer={t('teams.invitations.emptyBody')}>
                            <Item testID="team-invitations-empty" title={t('teams.invitations.emptyTitle')} showChevron={false} />
                        </ItemGroup>
                    ) : null}
                </>
            )}
            renderItem={({ item: segment }) => (
                <ItemGroup
                    title={segment.first ? t('teams.tabs.invitations') : undefined}
                    footer={segment.last
                        ? notice ?? (invitations.rows.some((row) => row.recipientEmailMask === null)
                            ? t('teams.invitations.bearerUnavailable')
                            : undefined)
                        : undefined}
                    virtualizedSegment={{ first: segment.first, last: segment.last }}
                >
                    {segment.items.map((row) => {
                        const presentation = resolveTeamInvitationPresentation(row, now);
                        const canRevoke = presentation.canRevoke && context.canMutate;
                        const canReissue = presentation.reissueMode !== 'none'
                            && context.canMutate
                            && (presentation.reissueMode !== 'email'
                                || invitations.emailDelivery === 'available');
                        const canChangeEmail = presentation.reissueMode === 'email'
                            && context.canMutate
                            && invitations.emailDelivery === 'available';
                        const isActionable = canRevoke || canReissue;
                        return (
                            <Item
                                key={row.id}
                                testID={`team-invitations-row:${row.id}`}
                                title={presentation.recipientLabel ?? t('teams.invitations.byLink')}
                                subtitle={[
                                    presentation.stateLabel,
                                    presentation.offerLabel,
                                    presentation.deliveryLabel,
                                ]
                                    .filter((part): part is string => part !== null)
                                    .join(' · ')}
                                detail={t('teams.invitations.expires', {
                                    when: new Date(row.expiresAt).toLocaleDateString(),
                                })}
                                disabled={isActionable && busy}
                                mode={isActionable ? 'interactive' : 'info'}
                                onPress={isActionable ? async () => {
                                    if (rowActionInFlightRef.current) return;
                                    rowActionInFlightRef.current = true;
                                    try {
                                    // One press offers the actions this row
                                    // actually has, as explicit choices.
                                    // Chaining two confirmations would turn
                                    // "cancel" into a different question.
                                    let chosen: 'revoke' | 'retry' | 'change_email' | null = null;
                                    await Modal.alertAsync(
                                        presentation.recipientLabel ?? t('teams.invitations.linkRow'),
                                        canReissue ? t('teams.invitations.reissueNotice') : t('teams.invitations.revokeBody'),
                                        [
                                            ...(canReissue ? [{
                                                text: t('teams.invitations.reissue'),
                                                onPress: () => { chosen = 'retry'; },
                                            }] : []),
                                            ...(canChangeEmail ? [{
                                                text: t('teams.invitations.deliveryChangeEmail'),
                                                onPress: () => { chosen = 'change_email'; },
                                            }] : []),
                                            ...(canRevoke ? [{
                                                text: t('teams.invitations.revoke'),
                                                style: 'destructive' as const,
                                                onPress: () => { chosen = 'revoke'; },
                                            }] : []),
                                            { text: t('common.cancel'), style: 'cancel' as const },
                                        ],
                                    );
                                    if (chosen === null) return;

                                    setBusy(true);
                                    setNotice(null);
                                    if (chosen === 'revoke') {
                                        let outcome: Awaited<ReturnType<typeof revokeTeamInvitation>>;
                                        try {
                                            outcome = await revokeTeamInvitation({
                                                scope: context.scope,
                                                address: context.address,
                                                invitationId: row.id,
                                                // An approved revocation is the
                                                // same revocation, so it is
                                                // reported and re-read here
                                                // rather than left unmentioned.
                                                onApprovalSucceeded: () => {
                                                    publishNotice(t('teams.invitations.stateRevoked'));
                                                    void invitations.reload();
                                                },
                                                onApprovalFailed: () =>
                                                    publishNotice(t('teams.errors.generic')),
                                            });
                                        } catch (cause) {
                                            setBusy(false);
                                            if (isTeamActionApprovalPendingError(cause)) {
                                                context.requestApproval(cause.registration);
                                            } else {
                                                publishNotice(t('teams.errors.generic'));
                                            }
                                            return;
                                        }
                                        setBusy(false);
                                        if (outcome.kind === 'failed') {
                                            // A revoke whose answer was lost may
                                            // have taken effect. The shared
                                            // vocabulary says so; the reload
                                            // below shows what the Home holds.
                                            publishNotice(teamMutationFailureLabel(outcome.failure));
                                        } else {
                                            publishNotice(t('teams.invitations.stateRevoked'));
                                        }
                                        void invitations.reload();
                                        return;
                                    }

                                    // Retry sends `null`, which the Home reads as
                                    // "the same offer to the same person": it
                                    // preserves an existing recipient constraint
                                    // rather than widening it into a link. Only
                                    // Change email supplies a new address, so
                                    // the mask never has to be reproduced here.
                                    let recipientEmail: string | null = null;
                                    if (chosen === 'change_email') {
                                        const entered = await Modal.prompt(
                                            t('teams.invitations.deliveryChangeEmail'),
                                            t('teams.invitations.reissueNotice'),
                                            {
                                                placeholder: t('teams.invitations.emailPlaceholder'),
                                                confirmText: t('teams.invitations.reissue'),
                                                inputType: 'email-address',
                                            },
                                        );
                                        const trimmed = entered?.trim() ?? '';
                                        if (trimmed.length < 3) {
                                            setBusy(false);
                                            return;
                                        }
                                        recipientEmail = trimmed;
                                    }

                                    let outcome: Awaited<ReturnType<typeof reissueTeamInvitation>>;
                                    const reissueIntent = JSON.stringify([
                                        row.id,
                                        chosen,
                                        recipientEmail,
                                    ]);
                                    const retryIdentity = reissueRequestIdentity.current?.intent === reissueIntent
                                        ? reissueRequestIdentity.current
                                        : Object.freeze({ intent: reissueIntent, requestKey: randomUUID() });
                                    reissueRequestIdentity.current = retryIdentity;
                                    try {
                                        outcome = await reissueTeamInvitation({
                                            scope: context.scope,
                                            address: context.address,
                                            invitationId: row.id,
                                            recipientEmail,
                                            requestKey: retryIdentity.requestKey,
                                            // Live-only custody: an explicit
                                            // UI approval keeps this call
                                            // pending and the replacement link
                                            // returns here, never to anything
                                            // durable.
                                            signal: bearerLifetime.current.signal,
                                        });
                                    } catch {
                                        if (bearerLifetime.current.signal.aborted) return;
                                        setBusy(false);
                                        publishNotice(t('teams.errors.generic'));
                                        return;
                                    }
                                    setBusy(false);
                                    if (outcome.kind === 'failed') {
                                        publishNotice(teamMutationFailureLabel(outcome.failure));
                                        void invitations.reload();
                                    } else {
                                        settleReissue(outcome.value);
                                    }
                                    } finally {
                                        rowActionInFlightRef.current = false;
                                    }
                                } : undefined}
                                showChevron={false}
                            />
                        );
                    })}
                </ItemGroup>
            )}
            ListFooterComponent={canManage ? (
                <>
                    {invitations.error ? (
                        <ItemGroup footer={t('teams.unavailable.offline')}>
                            <Item
                                testID="team-invitations-retry"
                                title={t('teams.unavailable.retry')}
                                icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                                onPress={() => void invitations.reload()}
                                showChevron={false}
                            />
                        </ItemGroup>
                    ) : invitations.hasMore && invitations.rows.length > 0 ? (
                        <ItemGroup>
                            <Item
                                testID="team-invitations-load-more"
                                title={t('homeGovernance.loadMore')}
                                loading={invitations.status === 'loading_more'}
                                disabled={invitations.status === 'loading_more'}
                                onPress={() => void invitations.loadMore()}
                                showChevron={false}
                            />
                        </ItemGroup>
                    ) : null}
                    {context.canMutate ? (
                        <ItemGroup>
                            <Item
                                testID="team-invitations-create"
                                title={t('teams.invitations.invite')}
                                onPress={() => router.push(teamInvitationCreatePath(context.address))}
                            />
                        </ItemGroup>
                    ) : null}
                </>
            ) : null}
            style={{
                flex: 1,
                backgroundColor: theme.colors.background.canvas,
                ...(Platform.OS === 'web' ? { minHeight: 0 } : {}),
            }}
            contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 34 : 16 }}
            backendPreference="auto"
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={7}
            estimatedItemSize={120}
            maintainVisibleContentPosition
        />
    );
});

export const TeamInvitationsScreen = React.memo(function TeamInvitationsScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    return (
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            title={t('teams.tabs.invitations')}
            presentation="virtualized-list"
        >
            {(context, header) => <InvitationsList context={context} header={header} />}
        </TeamSection>
    );
});
