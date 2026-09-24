import * as React from 'react';
import { useRouter } from 'expo-router';
import {
    TEAM_NAME_MAX_LENGTH_V1,
    validateTeamDescriptionV1,
    validateTeamNameV1,
    type TeamLogoSourceV1,
    type TeamSummaryV1,
} from '@happier-dev/protocol/teams';

import type { HomeAccountPickerRowV1 } from '@happier-dev/protocol/home/governance';

import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { TextInput } from '@/components/ui/text/Text';
import { useHomeAccountSearch } from '@/hooks/home/useHomeAccountSearch';
import { useHomeGovernanceEligibilitySnapshots } from '@/hooks/home/useHomeGovernanceEligibilitySnapshots';
import { useHomeGovernanceSnapshot } from '@/hooks/home/useHomeGovernanceSnapshot';
import { useServerCredentialAccountScopeResolutions } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useTeamsSettingsAdmission } from '@/hooks/teams/useTeamsSettingsAdmission';
import { randomUUID } from '@/platform/randomUUID';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { refreshHomeGovernanceSnapshot } from '@/sync/engine/home/governance/homeGovernanceEngine';
import { createTeam, setTeamLogo } from '@/sync/ops/teams/teamOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import { teamDetailPath } from './teamsRoutes';
import { TeamLogoPicker } from './TeamLogoPicker';

const OWNER_AVATAR_SIZE = 32;

type CommittedTeam = Readonly<{
    team: TeamSummaryV1;
    scope: ServerAccountScope;
    logoSource: TeamLogoSourceV1 | null;
}>;

/**
 * Who the Team's first owner will be, when that is a choice.
 *
 * Ordinary self-service creation has no choice to make: the creator is the
 * owner. It becomes a question only where the Home administers Team creation,
 * and there it must be answered explicitly — an administrator creating a Team
 * for somebody else never becomes a member of it.
 */
const InitialOwnerPicker = React.memo(function InitialOwnerPicker(props: Readonly<{
    scope: ServerAccountScope;
    selected: HomeAccountPickerRowV1 | null;
    onSelect: (account: HomeAccountPickerRowV1) => void;
}>) {
    const [query, setQuery] = React.useState('');
    const search = useHomeAccountSearch(props.scope, query, true);

    return (
        <>
            <ItemGroup
                title={t('teams.create.initialOwnerLabel')}
                footer={t('teams.create.initialOwnerHelp')}
            >
                <TextInput
                    testID="teams-create-owner-search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('teams.create.initialOwnerPlaceholder')}
                    accessibilityLabel={t('teams.create.initialOwnerLabel')}
                />
            </ItemGroup>

            {search.rows.length > 0 ? (
                <ItemGroup
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t('teams.create.initialOwnerLabel')}
                >
                    {search.rows.map((candidate) => (
                        <Item
                            key={candidate.accountId}
                            testID={`teams-create-owner:${candidate.accountId}`}
                            title={formatAccountDisplayName(candidate.profile) ?? candidate.accountId}
                            selected={props.selected?.accountId === candidate.accountId}
                            accessibilityRole="radio"
                            webRole="radio"
                            accessibilityChecked={props.selected?.accountId === candidate.accountId}
                            // A found-but-ineligible Account stays visible and
                            // unselectable, so it reads as "not eligible" rather
                            // than as "not on this Home".
                            disabled={!candidate.eligible}
                            leftElement={(
                                <Avatar
                                    id={candidate.accountId}
                                    size={OWNER_AVATAR_SIZE}
                                    imageUrl={candidate.profile.avatarUrl}
                                />
                            )}
                            onPress={() => props.onSelect(candidate)}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            ) : null}
        </>
    );
});

/**
 * Creating a Team.
 *
 * One compact form, never a wizard: a name, an optional description, and the
 * Home it is created on. The Home is always shown even when only one is
 * eligible, because a Team belongs to exactly one Home for its whole life and
 * that is not something to discover afterwards.
 */
export const TeamCreateScreen = React.memo(function TeamCreateScreen(props: Readonly<{
    /** Exact Home supplied only by the admitted Home Administration entry. */
    administrationServerId?: string;
}>) {
    const router = useRouter();
    const admission = useTeamsSettingsAdmission();
    const administrationServerId = props.administrationServerId?.trim() || null;
    const requestedServerIds = React.useMemo(
        () => administrationServerId ? [administrationServerId] : admission.capableServerIds,
        [administrationServerId, admission.capableServerIds],
    );
    const scopeResolutions = useServerCredentialAccountScopeResolutions(requestedServerIds);

    const candidateHomes = React.useMemo(() => {
        const out: Array<Readonly<{ scope: ServerAccountScope; homeName: string }>> = [];
        for (const serverId of requestedServerIds) {
            const resolution = scopeResolutions.get(serverId);
            if (resolution?.kind !== 'bound') continue;
            const profile = getServerProfileById(serverId);
            out.push({
                scope: resolution.scope,
                homeName: (profile?.name ?? '').trim() || (profile?.serverUrl ?? '') || serverId,
            });
        }
        return out;
    }, [requestedServerIds, scopeResolutions]);

    const ordinaryScopes = React.useMemo(
        () => administrationServerId ? [] : candidateHomes.map((home) => home.scope),
        [administrationServerId, candidateHomes],
    );
    const eligibility = useHomeGovernanceEligibilitySnapshots(ordinaryScopes);
    const homes = React.useMemo(() => administrationServerId
        ? candidateHomes
        : candidateHomes.filter((home) => {
            const snapshot = eligibility.snapshotsByServerId.get(home.scope.serverId);
            return snapshot?.data?.teamsEnabled === true && snapshot.data.createTeam;
        }), [administrationServerId, candidateHomes, eligibility.snapshotsByServerId]);

    const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null);
    const [name, setName] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [initialOwner, setInitialOwner] = React.useState<HomeAccountPickerRowV1 | null>(null);
    const [logoSource, setLogoSource] = React.useState<TeamLogoSourceV1 | null>(null);
    const [committedTeam, setCommittedTeam] = React.useState<CommittedTeam | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const nameInputRef = React.useRef<{ focus(): void } | null>(null);
    const submissionInFlightRef = React.useRef(false);

    // A single eligible Home is preselected but still displayed.
    const effectiveServerId = homes.some((home) => home.scope.serverId === selectedServerId)
        ? selectedServerId
        : homes[0]?.scope.serverId ?? null;
    const selected = homes.find((home) => home.scope.serverId === effectiveServerId) ?? null;

    const openCreatedTeam = React.useCallback((committed: CommittedTeam) => {
        router.replace(teamDetailPath({
            serverId: committed.scope.serverId,
            teamId: committed.team.id,
        }));
    }, [router]);

    /**
     * This screen's own deferred-approval host.
     *
     * Every other Team surface inherits one from the Team shell, but a Team
     * being created has no Team to hang it on — and creation is exactly the
     * intent whose answer cannot be recovered by re-reading anything, because
     * the new Team's id exists only in it. The key names the exact Home and
     * Account this submission is addressed to, so switching Homes mid-flight
     * releases the pending request here rather than letting another Home's
     * approval settle this form.
     */
    const approvalScopeKey = selected
        ? `team-create:${selected.scope.serverId}:${selected.scope.accountId}`
        : 'team-create:unbound';
    /**
     * Which of this form's two deferrable intents the pending approval is for.
     *
     * Creation carries its answer on the continuation, because the new Team's id
     * exists only there. Publishing the logo is addressed to a Team that is
     * already committed here, so its approval finishes by landing on that Team.
     */
    const approvalIntentRef = React.useRef<'create' | 'logo' | null>(null);
    const {
        approvalId,
        approvalStatus,
        approvalPending,
        isLoading: approvalLoading,
        error: approvalError,
        requestApproval,
    } = useActionApprovalContinuation({
        scopeKey: approvalScopeKey,
        serverId: selected?.scope.serverId ?? '',
        // The created Team arrives on the continuation, so creation has nothing
        // to refresh. An approved logo publication does: the Team is already
        // committed, and the person is still waiting on this form to finish.
        onExecuted: () => {
            if (approvalIntentRef.current !== 'logo') return;
            approvalIntentRef.current = null;
            if (committedTeam) openCreatedTeam(committedTeam);
        },
    });

    // One retry identity per submission attempt. A transport retry of the same
    // submission reuses it, so a lost response cannot create a second Team; it
    // is regenerated only when the payload the person is submitting changes.
    const requestKey = React.useRef(randomUUID());
    React.useEffect(() => {
        requestKey.current = randomUUID();
    }, [name, description, effectiveServerId, initialOwner?.accountId]);

    /**
     * Ordinary creation consumes only the Home's minimum eligibility answer.
     * The full projection is observed exclusively for an explicit Home
     * Administration entry, because only that flow may choose somebody else as
     * initial owner. The caller-supplied route context grants nothing: the
     * administrative projection remains server-authorized.
     */
    const governanceSnapshot = useHomeGovernanceSnapshot(
        administrationServerId ? selected?.scope ?? null : null,
    );
    const governance = governanceSnapshot?.data ?? null;
    const selectedEligibility = selected
        ? eligibility.snapshotsByServerId.get(selected.scope.serverId) ?? null
        : null;
    const selectedStale = administrationServerId
        ? governanceSnapshot?.stale === true || governanceSnapshot?.status === 'error'
        : selectedEligibility?.stale === true || selectedEligibility?.status === 'error';
    const creationRefused = administrationServerId !== null
        && governance !== null
        && (!governance.teamsEnabled || !governance.capabilities.createTeam);
    const mayNameInitialOwner = administrationServerId !== null
        && governance !== null
        && governance.capabilities.createTeam
        && governance.capabilities.manageAllTeams
        && governance.policy.teamCreationPolicy === 'managed_only';

    // Clearing a stale pick matters: the picked Account exists on one Home only.
    React.useEffect(() => {
        setInitialOwner(null);
        setLogoSource(null);
    }, [effectiveServerId]);

    const nameValidation = validateTeamNameV1(name);
    const descriptionValidation = validateTeamDescriptionV1(description);
    const canSubmit = nameValidation.status === 'ok'
        && descriptionValidation.status === 'ok'
        && selected !== null
        && (administrationServerId === null || governance !== null)
        && !creationRefused
        && !selectedStale
        && (!mayNameInitialOwner || initialOwner !== null)
        && !submitting
        // A deferred creation is already waiting on a person; offering the
        // button again would ask the Home to create a second Team.
        && !approvalPending;

    const uploadLogo = React.useCallback(async (committed: CommittedTeam) => {
        if (!committed.logoSource) return true;
        let logoOutcome: Awaited<ReturnType<typeof setTeamLogo>>;
        try {
            logoOutcome = await setTeamLogo({
                scope: committed.scope,
                address: { serverId: committed.scope.serverId, teamId: committed.team.id },
                image: committed.logoSource,
            });
        } catch (cause) {
            // An explicit UI-approval requirement defers the publication; it is
            // not an upload failure. Registering this exact request through the
            // screen's own approval host is what lets it finish on the Team that
            // is already committed — reporting a failure here instead would
            // offer a Retry that mints a second approval for the same upload.
            if (isTeamActionApprovalPendingError(cause)) {
                approvalIntentRef.current = 'logo';
                requestApproval(cause.registration);
                return false;
            }
            setError(t('teams.logo.failed'));
            return false;
        }
        if (logoOutcome.kind === 'succeeded') {
            openCreatedTeam({ ...committed, team: logoOutcome.team });
            return true;
        }
        setError(logoOutcome.failure.kind === 'outcome_unknown'
            ? t('teams.errors.outcomeUnknown')
            : logoOutcome.failure.kind === 'unreachable'
                ? t('teams.errors.offline')
                : t('teams.logo.failed'));
        return false;
    }, [openCreatedTeam, requestApproval]);

    const submit = React.useCallback(async () => {
        if (submissionInFlightRef.current) return;
        if (!selected || nameValidation.status !== 'ok' || descriptionValidation.status !== 'ok') {
            if (nameValidation.status !== 'ok') nameInputRef.current?.focus();
            return;
        }
        submissionInFlightRef.current = true;
        setSubmitting(true);
        setError(null);
        try {
            if (committedTeam) {
                const uploaded = await uploadLogo(committedTeam);
                if (uploaded && !committedTeam.logoSource) openCreatedTeam(committedTeam);
                return;
            }
            const submission: Omit<CommittedTeam, 'team'> = {
                scope: selected.scope,
                logoSource,
            };
            /**
             * One commitment for the immediate creation and the approved one.
             *
             * A Team created through an approval is the same Team: it is held
             * as the authoritative committed creation, its logo is published to
             * that exact id, and the person is taken to it — never asked to
             * submit the form again, which would create a second Team.
             */
            const commitCreatedTeam = async (team: TeamSummaryV1) => {
                const committed: CommittedTeam = { ...submission, team };
                setCommittedTeam(committed);
                if (!committed.logoSource) {
                    openCreatedTeam(committed);
                    return;
                }
                // Creation is already committed. Keep that authoritative Team and
                // the confirmed local logo source if publication fails; retrying
                // must upload to this ID, never repeat Team creation.
                await uploadLogo(committed);
            };
            const outcome = await createTeam({
                scope: submission.scope,
                name: nameValidation.name,
                description: descriptionValidation.description,
                // Absent means the creator owns it. A named owner is only ever the
                // one an authorized administrator explicitly chose.
                ...(mayNameInitialOwner && initialOwner
                    ? { initialOwnerAccountId: initialOwner.accountId }
                    : {}),
                requestKey: requestKey.current,
                onApprovalSucceeded: async (team) => {
                    // Publishing the logo to the approved Team is real work the
                    // person is waiting on, so it carries the same busy state
                    // an immediate creation does.
                    setSubmitting(true);
                    try {
                        await commitCreatedTeam(team);
                    } finally {
                        setSubmitting(false);
                    }
                },
                onApprovalFailed: (code) => setError(code === 'approval_rejected'
                    ? t('teams.errors.forbidden')
                    : t('teams.errors.generic')),
            });
            if (outcome.kind === 'succeeded') {
                await commitCreatedTeam(outcome.team);
                return;
            }
            // The form is preserved so a rejected submission is never retyped, and
            // the retry identity is kept so a repeat is the same submission.
            setError(outcome.failure.kind === 'forbidden'
                ? t('teams.errors.forbidden')
                : outcome.failure.kind === 'invalid'
                    ? t('teams.errors.invalidName')
                    : outcome.failure.kind === 'outcome_unknown'
                        ? t('teams.create.outcomeUnknown')
                        : outcome.failure.kind === 'unreachable'
                            ? t('teams.errors.offline')
                        : t('teams.errors.generic'));
        } catch (cause) {
            // An explicit UI-approval requirement defers the creation instead of
            // reaching the Home. Registering this exact request is what lets the
            // Team it produces arrive here; without it the submission would end
            // as an unhandled rejection and the person would be left on a form
            // whose Team may or may not exist.
            if (isTeamActionApprovalPendingError(cause)) {
                approvalIntentRef.current = 'create';
                requestApproval(cause.registration);
            } else setError(t('teams.errors.generic'));
        } finally {
            submissionInFlightRef.current = false;
            setSubmitting(false);
        }
    }, [selected, nameValidation, descriptionValidation, mayNameInitialOwner, initialOwner, committedTeam, uploadLogo, logoSource, openCreatedTeam, requestApproval]);

    const scopeResolutionPending = requestedServerIds.some((serverId) => {
        const resolution = scopeResolutions.get(serverId);
        return !resolution || resolution.kind === 'resolving';
    });
    const eligibilityLoading = administrationServerId === null
        && candidateHomes.some((home) => {
            const snapshot = eligibility.snapshotsByServerId.get(home.scope.serverId);
            return !snapshot || snapshot.status === 'loading';
        });
    const administrationLoading = administrationServerId !== null
        && selected !== null
        && (governanceSnapshot === null || governanceSnapshot.status === 'loading');
    const eligibilityUnavailable = administrationServerId === null
        && homes.length === 0
        && candidateHomes.some((home) => eligibility.snapshotsByServerId.get(home.scope.serverId)?.status === 'error');
    const eligibilityErrors = administrationServerId === null
        ? candidateHomes.flatMap((home) => {
            const error = eligibility.snapshotsByServerId.get(home.scope.serverId)?.error;
            return error ? [error] : [];
        })
        : [];
    const eligibilityRetryable = eligibilityErrors.some((failure) => failure.retryable);
    const eligibilityUnavailableMessage = eligibilityErrors.some((failure) => failure.kind === 'forbidden')
        ? t('teams.errors.forbidden')
        : eligibilityErrors.length > 0 && eligibilityErrors.every((failure) => failure.kind === 'unsupported')
            ? t('teams.unavailable.updateRequired')
            : t('teams.unavailable.offline');
    const administrationUnavailable = administrationServerId !== null
        && selected !== null
        && governanceSnapshot?.status === 'error'
        && governance === null;
    const administrationError = governanceSnapshot?.error ?? null;

    if (scopeResolutionPending || eligibilityLoading || administrationLoading) {
        return (
            <ItemList>
                <ItemGroup>
                    <Item testID="teams-create-loading" title={t('teams.title')} loading showChevron={false} />
                </ItemGroup>
            </ItemList>
        );
    }

    if (eligibilityUnavailable) {
        return (
            <ItemList>
                <ItemGroup footer={eligibilityUnavailableMessage}>
                    <Item
                        testID="teams-create-unavailable"
                        title={t('teams.unavailable.title')}
                        detail={eligibilityRetryable ? t('teams.unavailable.retry') : undefined}
                        onPress={eligibilityRetryable ? eligibility.refresh : undefined}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    if (administrationUnavailable) {
        const denied = administrationError?.kind === 'forbidden'
            || administrationError?.kind === 'unauthorized';
        const unsupported = administrationError?.kind === 'unsupported';
        return (
            <ItemList>
                <ItemGroup footer={denied
                    ? t('teams.errors.forbidden')
                    : unsupported
                        ? t('teams.unavailable.updateRequired')
                        : t('teams.unavailable.offline')}>
                    <Item
                        testID="teams-create-unavailable"
                        title={denied ? t('homeGovernance.forbiddenTitle') : t('teams.unavailable.title')}
                        detail={administrationError?.retryable ? t('teams.unavailable.retry') : undefined}
                        onPress={administrationError?.retryable && selected
                            ? () => void refreshHomeGovernanceSnapshot(selected.scope)
                            : undefined}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    if (homes.length === 0 || creationRefused) {
        // A Home that administers Team creation explains it rather than showing
        // a mysterious disabled control.
        return (
            <ItemList>
                <ItemGroup footer={t('teams.create.managedOnlyBody')}>
                    <Item
                        testID="teams-create-managed-only"
                        title={t('teams.create.managedOnlyTitle')}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    return (
        <ItemList keyboardAware>
            {/* A deferred creation is waiting on a person, not stuck. The same
                row every other Team surface shows says so and leads to the
                request, so the form never looks like it silently did nothing. */}
            {approvalId ? (
                <ItemGroup>
                    <Item
                        testID="teams-create-approval"
                        title={t('approvals.title')}
                        subtitle={approvalError
                            ? t('approvals.loadError')
                            : approvalLoading || approvalStatus === 'open' || approvalStatus === 'approved' || approvalStatus === 'executing'
                                ? t('approvals.status.open')
                                : t('approvals.details')}
                        accessibilityLiveRegion={approvalError ? 'assertive' : 'polite'}
                        onPress={() => router.push(
                            `/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(selected?.scope.serverId ?? '')}`,
                        )}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

            <ItemGroup title={t('teams.create.nameLabel')} footer={t('teams.create.duplicateNameNote')}>
                <TextInput
                    ref={nameInputRef}
                    testID="teams-create-name"
                    value={name}
                    onChangeText={setName}
                    placeholder={t('teams.create.namePlaceholder')}
                    accessibilityLabel={t('teams.create.nameLabel')}
                    maxLength={TEAM_NAME_MAX_LENGTH_V1}
                    editable={committedTeam === null}
                />
            </ItemGroup>

            <ItemGroup title={t('teams.create.descriptionLabel')}>
                <TextInput
                    testID="teams-create-description"
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('teams.create.descriptionPlaceholder')}
                    accessibilityLabel={t('teams.create.descriptionLabel')}
                    multiline
                    editable={committedTeam === null}
                />
            </ItemGroup>

            <TeamLogoPicker
                identityId={committedTeam?.team.id ?? requestKey.current}
                testIDPrefix="teams-create"
                currentLogo={null}
                selectedSource={committedTeam?.logoSource ?? logoSource}
                disabled={submitting || selectedStale || committedTeam !== null}
                onUse={async (source) => {
                    setLogoSource(source);
                    return { kind: 'succeeded' };
                }}
            />

            <ItemGroup
                title={t('teams.homeLabel')}
                footer={t('teams.create.homeHelp')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.homeLabel')}
            >
                {homes.map((home) => (
                    <Item
                        key={home.scope.serverId}
                        testID={`teams-create-home:${home.scope.serverId}`}
                        title={home.homeName}
                        selected={home.scope.serverId === (committedTeam?.scope.serverId ?? effectiveServerId)}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={home.scope.serverId === (committedTeam?.scope.serverId ?? effectiveServerId)}
                        disabled={submitting || committedTeam !== null}
                        onPress={() => setSelectedServerId(home.scope.serverId)}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            {mayNameInitialOwner && selected && committedTeam === null ? (
                <InitialOwnerPicker
                    // The picked Account belongs to one Home; remounting per
                    // Home keeps the search's own cache from crossing over.
                    key={selected.scope.serverId}
                    scope={selected.scope}
                    selected={initialOwner}
                    onSelect={setInitialOwner}
                />
            ) : null}

            {committedTeam ? (
                <ItemGroup footer={error ?? undefined}>
                    <Item
                        testID="teams-create-submit"
                        title={submitting ? t('teams.create.submitting') : t('teams.logo.retry')}
                        loading={submitting}
                        disabled={submitting || committedTeam.logoSource === null}
                        onPress={() => void submit()}
                        showChevron={false}
                    />
                    <Item
                        testID="teams-create-continue-without-logo"
                        title={t('common.continue')}
                        disabled={submitting}
                        onPress={() => openCreatedTeam(committedTeam)}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : selectedStale ? (
                <ItemGroup footer={t('teams.unavailable.offline')}>
                    <Item
                        testID="teams-create-stale"
                        title={t('teams.stale.label')}
                        detail={t('teams.unavailable.retry')}
                        onPress={administrationServerId
                            ? governanceSnapshot?.error?.retryable === false
                                ? undefined
                                : governanceSnapshot
                                    ? () => void refreshHomeGovernanceSnapshot(selected!.scope)
                                    : undefined
                            : eligibility.refresh}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : creationRefused ? (
                // An administered Home explains itself rather than leaving a
                // mysterious disabled control at the end of the form.
                <ItemGroup footer={t('teams.create.managedOnlyBody')}>
                    <Item
                        testID="teams-create-managed-only"
                        title={t('teams.create.managedOnlyTitle')}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : (
                <ItemGroup footer={error ?? undefined}>
                    <Item
                        testID="teams-create-submit"
                        title={submitting ? t('teams.create.submitting') : t('teams.create.submit')}
                        loading={submitting}
                        disabled={!canSubmit}
                        onPress={() => void submit()}
                        showChevron={false}
                    />
                </ItemGroup>
            )}
        </ItemList>
    );
});
