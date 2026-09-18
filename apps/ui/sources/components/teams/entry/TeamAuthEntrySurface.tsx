import * as React from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { HomeTargetInput } from '@happier-dev/cli-common/homeTarget';
import type {
    AuthEntryActionV1,
    AuthEntryProjectionV1,
    TeamInvitationAcceptResultV1,
    TeamEntryUnavailableReasonV1,
    TeamInvitationPostAuthContinuationV1,
} from '@happier-dev/protocol';

import { fetchAuthEntry } from '@/auth/entry/authEntryClient';
import { resolveHomeAuthenticationTarget } from '@/auth/flows/resolveHomeAuthenticationTarget';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { WelcomeActionCard } from '@/components/onboarding/preAuth/WelcomeActionCard';
import {
    WelcomeActionList,
    type WelcomeActionAdmission,
} from '@/components/onboarding/preAuth/WelcomeActionList';
import { presentTeamEntryUnavailableReason } from '@/components/teams/entry/teamAuthenticationFailure';
import { resolveTeamJoinPresentation } from '@/components/teams/join/teamJoinOutcome';
import { TeamInvitationPreviewDetails } from '@/components/teams/join/TeamInvitationPreviewDetails';
import { useTeamInvitationPreview } from '@/hooks/teams/useTeamInvitationPreview';
import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import {
    acceptTeamInvitation,
} from '@/sync/ops/teams/teamInvitationOperations';

type TeamAuthenticationAction = Extract<AuthEntryActionV1, { kind: 'authenticate' }>;
type TeamAdmissionProjection = Extract<AuthEntryProjectionV1, { state: 'admission_required' }>;
type InvitationAdmissionProjection = Extract<TeamAdmissionProjection, { scope: { kind: 'invitation' } }>;
/** The Home's answer for a caller it already recognizes as an effective member. */
type TeamContinueProjection = Extract<AuthEntryProjectionV1, { state: 'already_member' }>;
type TeamEntryProjection = TeamAdmissionProjection | TeamContinueProjection;
/** The Home's `unavailable` answer for a Team or invitation destination, with its reason. */
type TeamEntryUnavailableProjection = Extract<
    AuthEntryProjectionV1,
    { state: 'unavailable'; scope: { kind: 'team' | 'invitation' } }
>;

function isTeamEntryUnavailable(
    projection: AuthEntryProjectionV1,
): projection is TeamEntryUnavailableProjection {
    return projection.state === 'unavailable' && projection.scope.kind !== 'home';
}

type InvitationAdmissionSuccess = Extract<
    TeamInvitationAcceptResultV1,
    { outcome: 'joined' | 'already_member' }
>;
type InvitationAdmissionTerminal = Exclude<TeamInvitationAcceptResultV1, InvitationAdmissionSuccess>;

export type TeamAuthEntrySelection = Readonly<{
    action: TeamAuthenticationAction;
    teamId: string;
    teamName: string;
    /** Preserve the caller-supplied authority carrier instead of rebuilding it from the focused Home. */
    target: HomeTargetInput;
    /** Derived only from the Home's bounded invitation preview, never from the bearer shape. */
    invitationEmailVerificationRequired?: boolean;
}>;

type LoadState =
    | Readonly<{ kind: 'loading'; requestKey: symbol }>
    | Readonly<{ kind: 'ready'; requestKey: symbol; projection: TeamEntryProjection; refreshing: boolean }>
    | Readonly<{ kind: 'unavailable'; requestKey: symbol; reason: TeamEntryUnavailableReasonV1 }>
    | Readonly<{ kind: 'incompatible'; requestKey: symbol }>
    | Readonly<{ kind: 'offline'; requestKey: symbol }>;

type AdmissionState =
    | Readonly<{ kind: 'idle' }>
    | Readonly<{ kind: 'failed'; failure: HomeDomainFailure }>
    | Readonly<{ kind: 'incompatible' }>
    | Readonly<{ kind: 'terminal'; outcome: InvitationAdmissionTerminal['outcome'] }>
    /**
     * The deferred approval for this exact admission was refused, canceled or
     * failed. Nobody was admitted and the invitation itself is untouched, so
     * this is a retryable answer about the request rather than about the offer.
     */
    | Readonly<{ kind: 'approval_refused'; code: string }>
    /**
     * Admitted. The result is retained rather than consumed immediately because
     * opening the Team is an explicit transition the person makes: navigating
     * away on their behalf would replace the one moment that tells them what
     * just happened, and an already-member answer is not a request to leave the
     * page either.
     */
    | Readonly<{ kind: 'complete'; result: InvitationAdmissionSuccess }>;

const TEAM_LOGO_SIZE = 52;
const NOOP = () => {};

function fallbackHomeLabel(canonicalServerUrl: string): string {
    try {
        return new URL(canonicalServerUrl).host;
    } catch {
        return canonicalServerUrl;
    }
}

function isMatchingReadyState(
    state: LoadState,
    requestKey: symbol,
): state is Extract<LoadState, { kind: 'ready' }> {
    return state.kind === 'ready' && state.requestKey === requestKey;
}

function isInvitationAdmissionProjection(
    projection: TeamEntryProjection,
): projection is InvitationAdmissionProjection {
    return projection.state === 'admission_required' && projection.scope.kind === 'invitation';
}

type TeamAuthEntrySurfaceProps = Readonly<{
    target: HomeTargetInput;
    onSelectAction: (selection: TeamAuthEntrySelection) => Promise<void> | void;
    onBack?: () => void;
    /**
     * Re-opens authentication on this same Home before an addressed invitation
     * is accepted with the current Account. It is deliberately separate from
     * {@link onBack}: leaving the page and choosing another Account are different
     * intents, and a shell back control must not silently mean the second one.
     */
    onRecoverIdentity?: () => void;
    /** Returns a recovery attempt to the already-bound Account without accepting the invitation. */
    onUseCurrentAccount?: () => void;
}> & (
    | Readonly<{
        teamId: string;
        accountScope?: never;
        onContinue?: never;
        invitation?: never;
        onAdmissionComplete?: never;
    }>
    /**
     * Team entry for somebody already signed in to that exact Home. The scope is
     * what lets the Home answer as this Account; a caller without one — or on a
     * different Home — gets the ordinary anonymous admission page.
     */
    | Readonly<{
        teamId: string;
        accountScope: ServerAccountScope;
        onContinue: () => Promise<void> | void;
        invitation?: never;
        onAdmissionComplete?: never;
    }>
    | Readonly<{
        teamId?: never;
        accountScope?: never;
        onContinue?: never;
        invitation:
            | Readonly<{ token: string; accountScope?: ServerAccountScope }>
            | Readonly<{ continuation: TeamInvitationPostAuthContinuationV1; accountScope: ServerAccountScope }>;
        onAdmissionComplete: (result: InvitationAdmissionSuccess) => Promise<void> | void;
    }>
);

function admissionFailureTitle(failure: HomeDomainFailure): string {
    switch (failure.kind) {
        case 'outcome_unknown':
            return t('teams.join.acceptanceOutcomeUnknown');
        case 'unreachable':
        case 'unknown':
            return t('teams.join.offlineTitle');
        case 'unsupported':
        case 'invalid':
            return t('teams.join.updateRequiredTitle');
        case 'unauthorized':
            return t('teams.join.inactiveTitle');
        case 'forbidden':
            return t('teams.errors.forbidden');
        case 'conflict':
            return t('teams.errors.conflict');
    }
}

/**
 * What the shared approval owner decided, in the words this surface already
 * speaks. The codes come from the Action approval lifecycle, not from the Home's
 * invitation vocabulary, so they are presented as approval outcomes rather than
 * mistaken for something the invitation did.
 */
function approvalRefusalTitle(code: string): string {
    switch (code) {
        case 'approval_rejected':
            return t('approvals.status.rejected');
        case 'approval_canceled':
            return t('approvals.status.canceled');
        default:
            return t('approvals.status.failed');
    }
}

export const TeamAuthEntrySurface = React.memo(function TeamAuthEntrySurface(props: TeamAuthEntrySurfaceProps) {
    const router = useRouter();
    const resolvedTarget = React.useMemo(
        () => resolveHomeAuthenticationTarget(props.target),
        [props.target],
    );
    const invitation = props.invitation;
    const invitationToken = invitation && 'token' in invitation ? invitation.token : undefined;
    const invitationContinuation = invitation && 'continuation' in invitation
        ? invitation.continuation
        : undefined;
    const teamId = props.teamId ?? invitationContinuation?.teamId;
    // One Account scope for both variants: the invitation branch admits with it,
    // and the Team branch asks the Home as that Account. Both must belong to the
    // Home the caller named, which the effect below verifies before anything is sent.
    // It is rebuilt from its two identifying parts so a caller passing an inline
    // object cannot restart the request on every render.
    const scopeServerId = (invitation?.accountScope ?? props.accountScope)?.serverId;
    const scopeAccountId = (invitation?.accountScope ?? props.accountScope)?.accountId;
    const accountScope = React.useMemo<ServerAccountScope | undefined>(
        () => (scopeServerId && scopeAccountId
            ? { serverId: scopeServerId, accountId: scopeAccountId }
            : undefined),
        [scopeServerId, scopeAccountId],
    );
    const requestKey = React.useMemo(
        () => Symbol('team-auth-entry-request'),
        [
            resolvedTarget?.serverIdentityId,
            resolvedTarget?.endpointUrl,
            teamId,
            invitationToken,
            invitationContinuation?.reference,
            accountScope,
        ],
    );
    const [retryRevision, setRetryRevision] = React.useState(0);
    const [loadState, setLoadState] = React.useState<LoadState>({ kind: 'loading', requestKey });
    const [admissionState, setAdmissionState] = React.useState<AdmissionState>({ kind: 'idle' });
    const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);
    const activeActionIdRef = React.useRef<string | null>(null);
    const currentRequestKeyRef = React.useRef(requestKey);
    currentRequestKeyRef.current = requestKey;

    /**
     * Process-local custody for one deferred admission approval.
     *
     * Accepting an invitation is a dangerous, deferred, result-required intent,
     * so an explicit UI-approval requirement produces a durable approval request
     * instead of a join. This is the same shared owner the Team shell uses; the
     * bearer is what identifies this exact offer, and the key has the same
     * process-local residency as the bearer already held in props, so an
     * approval granted for another invitation, Account or Home cannot satisfy
     * it.
     */
    const invitationAuthority = invitationToken ?? invitationContinuation?.reference;
    const approvalScopeKey = invitationAuthority && accountScope
        ? `team-invitation-accept:${accountScope.serverId}:${accountScope.accountId}:${invitationAuthority}`
        : `team-auth-entry:${resolvedTarget?.serverId ?? ''}:${teamId ?? ''}`;
    const { approvalId, approvalPending, requestApproval } = useActionApprovalContinuation({
        scopeKey: approvalScopeKey,
        serverId: accountScope?.serverId ?? '',
        // The admission's own answer arrives on the continuation. This surface
        // owns no projection to re-read, so there is nothing to refresh.
        onExecuted: NOOP,
    });

    React.useEffect(() => {
        setAdmissionState({ kind: 'idle' });
        if (
            !resolvedTarget
            || (invitationToken === undefined && teamId === undefined)
            || (accountScope && !areServerProfileIdentifiersEquivalent(
                accountScope.serverId,
                resolvedTarget.serverId,
            ))
        ) {
            // No destination was resolvable at all, so there is nothing this
            // client may say about it beyond the Home's non-enumerating answer.
            setLoadState({ kind: 'unavailable', requestKey, reason: 'entry_not_available' });
            return;
        }

        const controller = new AbortController();
        setLoadState((current) => isMatchingReadyState(current, requestKey)
            ? { ...current, refreshing: true }
            : { kind: 'loading', requestKey });

        void (async () => {
            const transport = {
                endpointUrl: resolvedTarget.endpointUrl,
                serverId: resolvedTarget.serverId,
                signal: controller.signal,
            };
            // Each scope is requested through its own branch so the request stays
            // exactly one discriminated shape. The invitation bearer remains the
            // admission authority; an authenticated Account scope adds only the
            // bounded mailbox-relationship fact needed before confirmation.
            const result = invitationToken !== undefined
                ? await fetchAuthEntry({
                    ...transport,
                    scope: { kind: 'invitation', token: invitationToken },
                    ...(accountScope ? { accountScope } : {}),
                })
                : teamId !== undefined
                    ? await fetchAuthEntry({
                        ...transport,
                        scope: { kind: 'team', teamId },
                        ...(accountScope ? { accountScope } : {}),
                    })
                    : null;
            if (result === null) return;
            if (controller.signal.aborted) return;

            if (result.kind === 'ready') {
                const projection = result.projection;
                const hasMatchingScope = invitationToken
                    ? projection.scope.kind === 'invitation'
                    : projection.scope.kind === 'team';
                if (
                    hasMatchingScope
                    && (projection.state === 'admission_required' || projection.state === 'already_member')
                    && (teamId === undefined || projection.team.teamId === teamId)
                ) {
                    setLoadState({ kind: 'ready', requestKey, projection, refreshing: false });
                    return;
                }
                const terminal: LoadState = hasMatchingScope && isTeamEntryUnavailable(projection)
                    ? { kind: 'unavailable', requestKey, reason: projection.reason }
                    : { kind: 'incompatible', requestKey };
                setLoadState((current) => isMatchingReadyState(current, requestKey)
                    ? { ...current, refreshing: false }
                    : terminal);
                return;
            }

            const terminalKind: 'offline' | 'incompatible' = result.kind === 'unavailable'
                ? 'offline'
                : 'incompatible';
            setLoadState((current) => isMatchingReadyState(current, requestKey)
                ? { ...current, refreshing: false }
                : { kind: terminalKind, requestKey });
        })();

        return () => controller.abort();
    }, [
        accountScope,
        invitationToken,
        invitationContinuation,
        requestKey,
        resolvedTarget,
        retryRevision,
        teamId,
    ]);

    const runAction = React.useCallback(async (
        actionId: string,
        action: () => Promise<void> | void,
    ) => {
        if (activeActionIdRef.current !== null) return;
        activeActionIdRef.current = actionId;
        setPendingActionId(actionId);
        try {
            await action();
        } finally {
            if (activeActionIdRef.current === actionId) {
                activeActionIdRef.current = null;
                setPendingActionId(null);
            }
        }
    }, []);
    const effectivePendingActionId = loadState.kind === 'ready' && loadState.refreshing
        ? 'team-auth-entry-refreshing'
        : pendingActionId;
    const admission = React.useMemo<WelcomeActionAdmission>(() => ({
        pendingActionId: effectivePendingActionId,
        run: runAction,
    }), [effectivePendingActionId, runAction]);
    const retry = React.useCallback(() => {
        // Clear a completed admission attempt synchronously. The entry projection may
        // already be ready, so leaving this terminal state in place until the fetch
        // effect runs makes Retry appear to do nothing and lets callers observe stale UI.
        setAdmissionState({ kind: 'idle' });
        setLoadState({ kind: 'loading', requestKey });
        setRetryRevision((revision) => revision + 1);
    }, [requestKey]);

    /**
     * The bounded preview is the canonical owner of what accepting this exact
     * invitation does. Its public pre-authentication transport means the offer's
     * consequences are stated before anybody signs in, not only before the final
     * press — and it is what the explicit confirmation below is a confirmation
     * *of*, so the Join action stays withheld until this Home has described an
     * active offer rather than letting somebody accept an unread consequence.
     */
    const previewState = useTeamInvitationPreview({
        target: invitationToken ? props.target : undefined,
        token: invitationToken,
        revision: retryRevision,
    });
    const invitationIsJoinable = invitationContinuation !== undefined
        || (previewState.kind === 'ready' && previewState.preview.state === 'active');

    const acceptInvitation = React.useCallback(async (projection: TeamEntryProjection) => {
        if (!accountScope || (!invitationToken && !invitationContinuation) || approvalPending) return;
        setAdmissionState({ kind: 'idle' });
        const requestedKey = requestKey;
        /**
         * One settlement for the immediate answer and the approved one.
         *
         * An admission granted through approval is the same admission, so it
         * applies the Home's canonical result and the same exact-Team check
         * rather than degrading into "something changed, reload".
         */
        const settle = (value: TeamInvitationAcceptResultV1) => {
            if (currentRequestKeyRef.current !== requestedKey) return;
            if (value.outcome === 'joined' || value.outcome === 'already_member') {
                if (value.teamId !== projection.team.teamId) {
                    setAdmissionState({ kind: 'incompatible' });
                    return;
                }
                setAdmissionState({ kind: 'complete', result: value });
                return;
            }
            setAdmissionState({ kind: 'terminal', outcome: value.outcome });
        };

        let result: Awaited<ReturnType<typeof acceptTeamInvitation>>;
        try {
            result = await acceptTeamInvitation({
                scope: accountScope,
                admission: invitationContinuation
                    ? { continuation: invitationContinuation }
                    : { token: invitationToken! },
                onApprovalSucceeded: settle,
                onApprovalFailed: (code) => {
                    if (currentRequestKeyRef.current !== requestedKey) return;
                    setAdmissionState({ kind: 'approval_refused', code });
                },
            });
        } catch (cause) {
            if (currentRequestKeyRef.current !== requestedKey) return;
            if (isTeamActionApprovalPendingError(cause)) {
                // The admission was deferred, not lost. Registering this exact
                // request is what lets its approved answer come back here
                // instead of stranding the person on an offer that silently
                // never completed; settlement never redispatches, because the
                // Home admits them when the approval is granted.
                requestApproval(cause.registration);
                return;
            }
            setAdmissionState({
                kind: 'failed',
                failure: { kind: 'unknown', retryable: true, code: null },
            });
            return;
        }
        if (currentRequestKeyRef.current !== requestedKey) return;
        if (result.kind === 'failed') {
            setAdmissionState({ kind: 'failed', failure: result.failure });
            return;
        }
        settle(result.value);
    }, [accountScope, approvalPending, invitationContinuation, invitationToken, requestApproval, requestKey]);

    let content: React.ReactNode;
    if (loadState.kind === 'ready') {
        const { projection } = loadState;
        const teamName = projection.team.name;
        const homeDisplayName = projection.home.displayName
            ?? fallbackHomeLabel(resolvedTarget?.canonicalServerUrl ?? '');
        const accountLabel = projection.account
            ? formatAccountDisplayName(projection.account) ?? t('teams.entry.unnamedAccount')
            : null;
        const admissionComplete = admissionState.kind === 'complete' ? admissionState.result : null;
        const admissionTerminal = admissionState.kind === 'terminal' ? admissionState : null;
        const admissionTerminalPresentation = admissionTerminal
            ? resolveTeamJoinPresentation({ outcome: admissionTerminal.outcome })
            : null;
        const invitationProjection = isInvitationAdmissionProjection(projection)
            ? projection
            : null;
        const invitedMailboxVerificationRequired = invitationProjection
            ?.currentAccountRecipientStatus === 'verification_required';
        const invitedMailboxMask = previewState.kind === 'ready'
            ? previewState.preview.recipientEmailMask
            : null;
        const switchAccountOffered = projection.state === 'admission_required'
            && projection.actions.some((action) => action.kind === 'switch_account');
        content = (
            <View testID="team-auth-entry-ready" style={styles.content}>
                <View testID="team-auth-entry-lockup" style={styles.lockup}>
                    <View
                        testID="team-auth-entry-logo"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                    >
                        <Avatar
                            id={projection.team.teamId}
                            square
                            size={TEAM_LOGO_SIZE}
                            imageUrl={projection.team.logo?.url ?? null}
                            thumbhash={projection.team.logo?.thumbhash ?? null}
                        />
                    </View>
                    <Text
                        testID="team-auth-entry-team-name"
                        accessibilityLabel={teamName}
                        numberOfLines={2}
                        style={styles.teamName}
                    >
                        {teamName}
                    </Text>
                </View>
                <View>
                    <Text
                        testID="team-auth-entry-heading"
                        accessibilityRole="header"
                        accessibilityLabel={t('teams.entry.heading', { team: teamName })}
                        numberOfLines={2}
                        role="heading"
                        style={styles.heading}
                    >
                        {t('teams.entry.heading', { team: teamName })}
                    </Text>
                    <Text style={styles.subtitle}>
                        {t('teams.entry.onHome', {
                            home: homeDisplayName,
                        })}
                    </Text>
                    {accountLabel ? (
                        <Text
                            testID="team-auth-entry-account-label"
                            accessibilityRole="text"
                            style={styles.guidance}
                        >
                            {t('teams.entry.signedInTo', { home: homeDisplayName, account: accountLabel })}
                        </Text>
                    ) : null}
                </View>
                {admissionComplete ? (
                    <SurfaceStateCard
                        testID="team-auth-entry-admission-complete"
                        kind="empty"
                        title={resolveTeamJoinPresentation(admissionComplete).title}
                        action={{
                            label: t('teams.join.openTeam', { team: teamName }),
                            onPress: () => { void props.onAdmissionComplete?.(admissionComplete); },
                        }}
                        accessibilitySemantics="status"
                    />
                ) : admissionTerminal && admissionTerminalPresentation ? (
                    <SurfaceStateCard
                        testID={`team-auth-entry-admission-${admissionTerminal.outcome}`}
                        kind="warning"
                        title={admissionTerminalPresentation.title}
                        reason={admissionTerminalPresentation.body ?? undefined}
                        action={admissionTerminalPresentation.identityAction === 'sign_in_with_invited' && props.onRecoverIdentity ? {
                            label: t('teams.join.signInWithInvited'),
                            onPress: props.onRecoverIdentity,
                        } : undefined}
                        accessibilitySemantics="status"
                    />
                ) : admissionState.kind === 'incompatible' ? (
                    <SurfaceStateCard
                        testID="team-auth-entry-admission-incompatible"
                        kind="warning"
                        title={t('teams.join.updateRequiredTitle')}
                        action={{ label: t('common.retry'), onPress: retry }}
                        accessibilitySemantics="status"
                    />
                ) : admissionState.kind === 'failed' ? (
                    <SurfaceStateCard
                        testID={`team-auth-entry-admission-failure-${admissionState.failure.kind}`}
                        kind="error"
                        title={admissionFailureTitle(admissionState.failure)}
                        reason={admissionState.failure.kind === 'unreachable'
                            || admissionState.failure.kind === 'unknown'
                            ? t('teams.join.offlineBody')
                            : undefined}
                        action={(admissionState.failure.retryable
                            || admissionState.failure.kind === 'outcome_unknown') ? {
                            label: t('teams.join.retry'),
                            onPress: () => runAction(
                                'team-auth-entry-admission-retry',
                                () => acceptInvitation(projection),
                            ),
                        } : undefined}
                        accessibilitySemantics="status"
                    />
                ) : admissionState.kind === 'approval_refused' ? (
                    <SurfaceStateCard
                        testID="team-auth-entry-admission-approval-refused"
                        kind="warning"
                        title={approvalRefusalTitle(admissionState.code)}
                        // Nobody was admitted and the invitation is untouched,
                        // so the same offer stays retryable from here.
                        action={{
                            label: t('teams.join.retry'),
                            onPress: () => runAction(
                                'team-auth-entry-admission-retry',
                                () => acceptInvitation(projection),
                            ),
                        }}
                        accessibilitySemantics="status"
                    />
                ) : approvalPending ? (
                    <SurfaceStateCard
                        testID="team-auth-entry-admission-approval"
                        kind="loading"
                        title={t('approvals.title')}
                        reason={t('approvals.status.open')}
                        action={approvalId && accountScope ? {
                            label: t('approvals.details'),
                            onPress: () => router.push(
                                `/inbox/approvals/${encodeURIComponent(approvalId)}`
                                + `?serverId=${encodeURIComponent(accountScope.serverId)}`,
                            ),
                        } : undefined}
                        accessibilitySemantics="status"
                    />
                ) : (
                    <>
                        <Text
                            testID="team-auth-entry-status"
                            accessibilityRole="text"
                            accessibilityLiveRegion="polite"
                            aria-live="polite"
                            role="status"
                            style={styles.guidance}
                        >
                            {projection.state === 'already_member'
                                ? t('teams.join.alreadyMemberTitle')
                                : t('teams.entry.readyStatus')}
                        </Text>
                        {invitationToken ? (
                            <TeamInvitationPreviewDetails state={previewState} onRetry={retry} />
                        ) : null}
                        <WelcomeActionList admission={admission}>
                            {projection.state === 'already_member' ? (
                                <WelcomeActionCard
                                    testID="team-auth-entry-continue"
                                    primary
                                    title={invitation
                                        ? t('teams.join.openTeam', { team: teamName })
                                        : t('common.continue')}
                                    onPress={() => invitation
                                        ? props.onAdmissionComplete?.({ outcome: 'already_member', teamId: projection.team.teamId })
                                        : props.onContinue?.()}
                                />
                            ) : invitation && accountScope ? (
                                invitationIsJoinable ? (
                                    <>
                                        <WelcomeActionCard
                                            testID="team-auth-entry-join"
                                            primary
                                            title={invitedMailboxVerificationRequired
                                                ? t('teams.join.joinWithCurrentAccount')
                                                : t('teams.join.joinAction', { team: teamName })}
                                            subtitle={invitedMailboxVerificationRequired && invitedMailboxMask
                                                ? t('teams.join.addInvitedAddressNotice', { email: invitedMailboxMask })
                                                : undefined}
                                            onPress={() => acceptInvitation(projection)}
                                        />
                                        {switchAccountOffered && props.onRecoverIdentity ? (
                                            <WelcomeActionCard
                                                testID="team-auth-entry-use-another-account"
                                                primary={false}
                                                title={t('teams.join.useAnotherAccount')}
                                                subtitle={t('teams.join.useAnotherAccountHint')}
                                                onPress={props.onRecoverIdentity}
                                            />
                                        ) : null}
                                    </>
                                ) : null
                            ) : invitation && !invitationIsJoinable ? null : <>
                                {projection.actions.map((action, index) => action.kind === 'authenticate' ? (
                                    <WelcomeActionCard
                                        key={`${action.origin}:${action.methodId}:${action.action}:${action.mode}`}
                                        testID={`team-auth-entry-action:${action.methodId}`}
                                        primary={index === 0}
                                        title={t('teams.entry.continueWith', { method: action.presentation.displayName })}
                                        onPress={() => props.onSelectAction({
                                            action,
                                            teamId: projection.team.teamId,
                                            teamName: projection.team.name,
                                            target: props.target,
                                            ...(invitation ? {
                                                invitationEmailVerificationRequired:
                                                    invitationProjection?.invitationEmailVerificationRequired === true,
                                            } : {}),
                                        })}
                                    />
                                ) : null)}
                                {invitation && props.onUseCurrentAccount ? (
                                    <WelcomeActionCard
                                        testID="team-auth-entry-use-current-account"
                                        primary={false}
                                        title={t('teams.join.useCurrentAccount')}
                                        onPress={props.onUseCurrentAccount}
                                    />
                                ) : null}
                            </>}
                        </WelcomeActionList>
                    </>
                )}
            </View>
        );
    } else if (loadState.kind === 'loading') {
        content = (
            <View style={styles.content}>
                <View testID="team-auth-entry-lockup-placeholder" style={styles.lockup}>
                    <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={styles.logoPlaceholder}
                    />
                    <View style={styles.namePlaceholder} />
                </View>
                <SurfaceStateCard
                    testID="team-auth-entry-loading"
                    kind="loading"
                    title={t('common.loading')}
                    accessibilitySemantics="status"
                />
            </View>
        );
    } else {
        const isIncompatible = loadState.kind === 'incompatible';
        const isOffline = loadState.kind === 'offline';
        // A Home that named its reason gets §10 copy that says what to do next;
        // `entry_not_available` keeps the opaque card that reveals nothing.
        const named = loadState.kind === 'unavailable'
            ? presentTeamEntryUnavailableReason(loadState.reason)
            : null;
        content = (
            <SurfaceStateCard
                testID={`team-auth-entry-${loadState.kind}`}
                kind={named?.kind ?? (isIncompatible ? 'warning' : isOffline ? 'error' : 'unavailable')}
                title={named?.title ?? (isIncompatible
                    ? t('teams.join.updateRequiredTitle')
                    : isOffline
                        ? t('teams.join.offlineTitle')
                        : t('teams.errors.notFound'))}
                reason={named?.body ?? (isOffline ? t('teams.join.offlineBody') : undefined)}
                {...(loadState.kind === 'unavailable' && named
                    ? { diagnosticCode: loadState.reason }
                    : {})}
                action={{ label: t('common.retry'), onPress: retry }}
                accessibilitySemantics="status"
            />
        );
    }

    return (
        <UnauthenticatedSplitShell
            testID="team-auth-entry-shell"
            stepId={`team-auth-entry:${loadState.kind}`}
            isWelcomeStep={false}
            allowMobileBrandHero={false}
            onOpenRelayCustomFlow={NOOP}
            onBrandHeroGetStarted={NOOP}
            onBack={props.onBack}
        >
            {content}
        </UnauthenticatedSplitShell>
    );
});

const styles = StyleSheet.create((theme) => ({
    content: {
        width: '100%',
        gap: 22,
    },
    lockup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minWidth: 0,
    },
    teamName: {
        ...Typography.default('semiBold'),
        flex: 1,
        minWidth: 0,
        fontSize: 16,
        lineHeight: 22,
        color: theme.colors.text.primary,
    },
    logoPlaceholder: {
        width: TEAM_LOGO_SIZE,
        height: TEAM_LOGO_SIZE,
        backgroundColor: theme.colors.surface.elevated,
        borderRadius: 8,
    },
    namePlaceholder: {
        width: '58%',
        height: 18,
        backgroundColor: theme.colors.surface.elevated,
        borderRadius: 6,
    },
    heading: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        lineHeight: 34,
        color: theme.colors.text.primary,
    },
    subtitle: {
        ...Typography.default(),
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
    },
    guidance: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
    },
}));
