import * as React from 'react';
import { useRouter } from 'expo-router';
import {
    TEAM_GROUP_NAME_MAX_LENGTH_V1,
    validateTeamGroupDescriptionV1,
    validateTeamGroupNameV1,
    type SessionHistoryAccessV1,
    type TeamGroupMemberMutationResultV1,
    type TeamGroupMemberV1,
    type TeamGroupV1,
} from '@happier-dev/protocol/teams';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { TextInput } from '@/components/ui/text/Text';
import { useTeamGroup, useTeamGroupMembers } from '@/hooks/teams/useTeamGroups';
import { useTeamMembersRoster } from '@/hooks/teams/useTeamMembersRoster';
import { Modal } from '@/modal';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import {
    addTeamGroupMember,
    archiveTeamGroup,
    removeTeamGroupMember,
    restoreTeamGroup,
    updateTeamGroup,
    type TeamGroupOutcome,
} from '@/sync/ops/teams/teamGroupOperations';
import {
    isTeamActionApprovalPendingError,
} from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import { useEditedMetadataDraft } from '../useEditedMetadataDraft';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamMutationFailureLabel, teamReadFailureLabel } from '../teamMutationPresentation';
import { groupManagementLabel } from '../teamLabels';
import {
    teamDirectorySourcePath,
    teamGroupMemberDetailPath,
    teamIdentityConnectionPath,
} from '../teamsRoutes';

const MEMBER_AVATAR_SIZE = 32;
const GROUP_DETAIL_CHUNK_SIZE = 12;

type GroupDetailVirtualizedRow = Readonly<{
    key: string;
    render: () => React.ReactElement;
}>;

/**
 * Why this person is in this Group, in the words a manager can act on.
 *
 * A native contribution alongside an external one is what makes a native remove
 * *not* a removal, so the row says where the remaining contribution comes from
 * rather than presenting a control whose effect would surprise.
 */
function contributionLabel(member: TeamGroupMemberV1): string | null {
    const external = member.contributions.external;
    if (external.length === 0) return null;
    return t('teams.groups.managedBy', {
        source: external.map((entry) => entry.label).join(', '),
    });
}

/**
 * Editing a Group's own name and description.
 *
 * A directory-created Group keeps native archive authority but not necessarily
 * metadata authority, so the section is offered only when the server's own
 * `updateMetadata` capability backs it rather than inferred from `management`.
 */
const GroupMetadataSection = React.memo(function GroupMetadataSection(props: Readonly<{
    context: TeamSectionContext;
    group: TeamGroupV1;
    /**
     * Whether this Group's own projection is current. A retained Group whose
     * point read failed keeps its content on screen, but its capabilities are
     * last-known, so writing through them is withheld until it answers again.
     */
    current: boolean;
}>) {
    const { context, group, current } = props;
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const saveInFlightRef = React.useRef(false);

    React.useEffect(() => () => {
        saveInFlightRef.current = false;
    }, []);

    // The Home's answer stays authoritative when the Group moves under the
    // editor, but it never erases an unfinished draft: this is the same editor
    // owner the Team's own identity section uses.
    const draft = useEditedMetadataDraft({
        name: group.name,
        description: group.description ?? '',
    });
    const { name, description, conflict } = draft;

    const nameValidation = validateTeamGroupNameV1(name);
    const descriptionValidation = validateTeamGroupDescriptionV1(description);
    const archived = group.archivedAt !== null;
    const editable = context.canMutate && current && !archived;
    const changed = nameValidation.status === 'ok'
        && descriptionValidation.status === 'ok'
        && (nameValidation.name !== group.name
            || (descriptionValidation.description ?? '') !== (group.description ?? ''));

    if (!group.capabilities.updateMetadata) return null;

    return (
        <>
            <ItemGroup title={t('teams.groups.nameLabel')}>
                <TextInput
                    testID="team-group-name"
                    value={name}
                    onChangeText={draft.setName}
                    placeholder={t('teams.groups.namePlaceholder')}
                    accessibilityLabel={t('teams.groups.nameLabel')}
                    maxLength={TEAM_GROUP_NAME_MAX_LENGTH_V1}
                    editable={editable}
                />
            </ItemGroup>
            <ItemGroup
                title={t('teams.create.descriptionLabel')}
                footer={error ?? (descriptionValidation.status !== 'ok'
                    ? t('teams.errors.invalidDescription')
                    : undefined)}
            >
                <TextInput
                    testID="team-group-description"
                    value={description}
                    onChangeText={draft.setDescription}
                    placeholder={t('teams.create.descriptionPlaceholder')}
                    accessibilityLabel={t('teams.create.descriptionLabel')}
                    multiline
                    editable={editable}
                />
                {conflict ? (
                    <Item
                        testID="team-group-identity-conflict"
                        title={t('teams.errors.conflict')}
                        subtitle={[group.name, group.description ?? ''].filter(Boolean).join('\n')}
                        detail={t('common.continue')}
                        accessibilityLiveRegion="assertive"
                        disabled={saving}
                        onPress={draft.acceptPublished}
                        showChevron={false}
                    />
                ) : null}
                <Item
                    testID="team-group-save"
                    title={t('common.save')}
                    loading={saving}
                    disabled={!changed
                        || conflict
                        || descriptionValidation.status !== 'ok'
                        || saving
                        || !editable}
                    onPress={async () => {
                        if (saveInFlightRef.current
                            || nameValidation.status !== 'ok'
                            || descriptionValidation.status !== 'ok') return;
                        saveInFlightRef.current = true;
                        setSaving(true);
                        setError(null);
                        let outcome: Awaited<ReturnType<typeof updateTeamGroup>>;
                        try {
                            outcome = await updateTeamGroup({
                                scope: context.scope,
                                address: context.address,
                                groupId: group.id,
                                name: nameValidation.name,
                                description: descriptionValidation.description,
                            });
                        } catch (cause) {
                            saveInFlightRef.current = false;
                            setSaving(false);
                            if (isTeamActionApprovalPendingError(cause)) {
                                context.requestApproval(cause.artifactId);
                            } else {
                                setError(t('teams.errors.generic'));
                            }
                            return;
                        }
                        saveInFlightRef.current = false;
                        setSaving(false);
                        if (outcome.kind === 'failed') {
                            setError(outcome.failure.kind === 'conflict'
                                ? t('teams.groups.nameTaken')
                                : teamMutationFailureLabel(outcome.failure));
                            return;
                        }
                        draft.commit({
                            name: outcome.value.name,
                            description: outcome.value.description ?? '',
                        });
                    }}
                    showChevron={false}
                />
            </ItemGroup>
        </>
    );
});

const GroupDetail = React.memo(function GroupDetail(props: Readonly<{
    context: TeamSectionContext;
    groupId: string;
    header?: React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context, groupId } = props;
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [picking, setPicking] = React.useState(false);
    const mutationInFlightRef = React.useRef(false);

    React.useEffect(() => () => {
        mutationInFlightRef.current = false;
    }, []);
    /**
     * The Group's own history intent, independent of any Team horizon.
     *
     * The membership owner consumes it only when this membership's first
     * contribution mints a horizon and never widens a retained one, so copying a
     * person's existing Team horizon here would silently answer a different
     * question than the one the manager is being asked.
     */
    const [groupHistoryAccess, setGroupHistoryAccess] = React.useState<SessionHistoryAccessV1>(
        context.team.policy.defaultSessionHistoryAccess,
    );
    const detail = useTeamGroup({
        scope: context.scope,
        address: context.address,
        groupId,
        enabled: true,
    });

    const members = useTeamGroupMembers({
        scope: context.scope,
        address: context.address,
        groupId,
        enabled: detail.group !== null,
    });

    // Group candidates are the Team's own members: a Group is a subset of the
    // Team, so the Team roster is the right source rather than a Home-wide search.
    const candidates = useTeamMembersRoster({
        scope: context.scope,
        address: context.address,
        filter: 'all',
        enabled: picking,
    });

    // Candidate exclusion is only truthful once every Group-member page has
    // contributed its native Account ids. Complete that bounded read while the
    // picker is open; showing Team candidates sooner can offer someone whose
    // native contribution sits on a later Group page.
    React.useEffect(() => {
        if (!picking || members.error || !members.hasMore) return;
        if (members.status === 'loading' || members.status === 'loading_more') return;
        void members.loadMore();
    }, [picking, members.error, members.hasMore, members.status, members.loadMore]);

    // Every hook below runs on the loading and unavailable renders too. A Group
    // that arrives after the first paint is the ordinary cold path, so the
    // rendered branch may not change how many hooks this component calls.
    const group = detail.group;
    const archived = group !== null && group.archivedAt !== null;
    const managedBy = group === null ? null : groupManagementLabel(group);
    /**
     * This Group's own currentness, which is not the Team's.
     *
     * A Group point-refresh can fail beside a Team read that succeeded. The
     * retained Group stays on screen — losing it would be worse — but its
     * capabilities are then last-known rather than current, so the Group's own
     * writes are withheld and its own failure is named with its own retry
     * instead of being presented as a current Group nobody can explain.
     */
    const groupCurrent = detail.isCurrent;
    const groupStale = group !== null && !groupCurrent;
    const canEditRoster = group !== null
        && group.capabilities.manageNativeMembers
        && context.canMutate
        && groupCurrent
        && !archived
        && !busy;
    const nativeAccountIds = React.useMemo(() => new Set(
        members.rows.filter((member) => member.contributions.native).map((member) => member.accountId),
    ), [members.rows]);
    const nativeRosterReady = !members.error
        && !members.hasMore
        && members.status !== 'loading'
        && members.status !== 'loading_more';

    /**
     * One settlement for the immediate roster answer and the approved one.
     *
     * A native removal that leaves an external contribution is not a removal;
     * saying so is the difference between a truthful roster and a lie, and an
     * approved mutation owes the same truth as an immediate one.
     */
    const settleRosterChange = React.useCallback((
        result: TeamGroupMemberMutationResultV1,
        externalLabel: string | null,
    ) => {
        if (result.status === 'contribution_removed') {
            setNotice(externalLabel
                ? t('teams.groups.externalOnlyBody', { source: externalLabel })
                : t('teams.groups.externalOnlyTitle'));
        }
        void members.reload();
        void detail.reload();
    }, [detail.reload, members.reload]);

    const runRosterChange = React.useCallback(async (
        operation: () => Promise<TeamGroupOutcome<TeamGroupMemberMutationResultV1>>,
        externalLabel: string | null,
    ) => {
        if (mutationInFlightRef.current) return;
        mutationInFlightRef.current = true;
        setBusy(true);
        setNotice(null);
        let outcome: Awaited<ReturnType<typeof operation>>;
        try {
            outcome = await operation();
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) {
                // The roster change was deferred, not lost. Registering this
                // exact request is what lets its approved answer settle here;
                // settlement never redispatches, because the Home performs the
                // mutation when the approval is granted.
                context.requestApproval(cause.registration);
            } else {
                setNotice(t('teams.errors.generic'));
            }
            setBusy(false);
            mutationInFlightRef.current = false;
            return;
        }
        setBusy(false);
        mutationInFlightRef.current = false;
        if (outcome.kind === 'failed') {
            setNotice(teamMutationFailureLabel(outcome.failure));
            if (outcome.failure.kind === 'outcome_unknown') {
                void members.reload();
                void detail.reload();
            }
            return;
        }
        settleRosterChange(outcome.value, externalLabel);
        return outcome;
    }, [context, detail.reload, members.reload, settleRosterChange]);

    /**
     * Including existing history is an instruction, not just a stored policy, so the
     * journey continues at that member's detail where the one preparation operation
     * lives. Future-only membership stays on the roster: there is nothing to prepare.
     */
    const addNative = React.useCallback(async (member: Readonly<{ accountId: string; membershipId: string }>) => {
        // The instruction this exact contribution carries, captured before the
        // await so a later Group-history change cannot retarget an approved
        // answer that was requested under the previous one.
        const includeHistory = groupHistoryAccess === 'all_existing';
        const continueHistoryPreparation = (result: TeamGroupMemberMutationResultV1) => {
            if (result.status !== 'added' || !includeHistory) return;
            router.push(teamGroupMemberDetailPath(
                context.address,
                member.membershipId,
                groupId,
                member.accountId,
                { prepareHistory: true },
            ));
        };
        const outcome = await runRosterChange(
            () => addTeamGroupMember({
                scope: context.scope,
                address: context.address,
                groupId,
                accountId: member.accountId,
                historyAccess: groupHistoryAccess,
                // An approved contribution is the same contribution and carries
                // the same instruction, so it settles the roster and continues
                // the preparation journey rather than ending as "reload".
                onApprovalSucceeded: (result) => {
                    settleRosterChange(result, null);
                    continueHistoryPreparation(result);
                },
                onApprovalFailed: () => setNotice(t('teams.errors.generic')),
            }),
            null,
        );
        if (outcome?.kind !== 'succeeded') return;
        continueHistoryPreparation(outcome.value);
    }, [
        context.address,
        context.scope,
        groupHistoryAccess,
        groupId,
        router,
        runRosterChange,
        settleRosterChange,
    ]);

    const eligibleCandidates = React.useMemo(
        () => nativeRosterReady
            ? candidates.rows.filter((membership) => !nativeAccountIds.has(membership.accountId))
            : [],
        [candidates.rows, nativeAccountIds, nativeRosterReady],
    );

    const rows = React.useMemo<readonly GroupDetailVirtualizedRow[]>(() => {
        const result: GroupDetailVirtualizedRow[] = [];
        if (group === null) return result;
        const add = (key: string, render: () => React.ReactElement) => result.push({ key, render });

        add('summary', () => (
            <ItemGroup title={group.name} footer={group.description ?? undefined}>
                <Item
                    testID="team-group-member-count"
                    detailTestID="team-group-member-count-value"
                    title={t('teams.groups.membersSection')}
                    detail={t('teams.groups.memberCount', { count: group.memberCount })}
                    showChevron={false}
                />
                {/* Metadata ownership is stated where it applies, and says what
                    stays possible: an externally created Group is read-only for
                    its name and lifecycle, never for its native roster. */}
                {managedBy ? (() => {
                    const management = group.management;
                    const managementPath = management.kind === 'directory_created'
                        ? management.owner.kind === 'directory_source'
                            ? teamDirectorySourcePath(context.address, management.owner.directorySourceId)
                            : teamIdentityConnectionPath(
                                context.address,
                                management.owner.teamIdentityConnectionId,
                            )
                        : null;
                    return (
                    <Item
                        testID="team-group-managed-by"
                        mode="info"
                        title={t('teams.members.detailManagedBy')}
                        detail={managedBy}
                        subtitle={t('teams.groups.managedReadOnly')}
                        onPress={managementPath !== null
                            ? () => router.push(managementPath)
                            : undefined}
                        showChevron={managementPath !== null}
                    />
                    );
                })() : null}
                {archived ? (
                    <Item
                        testID="team-group-archived"
                        title={t('teams.directory.archivedBadge')}
                        subtitle={t('teams.groups.archivedReadOnly')}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        ));

        if (groupStale) {
            const failure = detail.error;
            add('group-stale', () => (
                <ItemGroup footer={failure
                    ? teamReadFailureLabel(failure)
                    : t('teams.stale.label')}>
                    <Item
                        testID="team-group-stale"
                        title={t('teams.stale.label')}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        accessibilityLiveRegion="polite"
                        showChevron={false}
                    />
                    {failure === null || failure.retryable ? (
                        <Item
                            testID="team-group-stale-retry"
                            title={t('teams.unavailable.retry')}
                            onPress={() => void detail.reload()}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ));
        }

        if (group.capabilities.updateMetadata) {
            add('metadata', () => <GroupMetadataSection context={context} group={group} current={groupCurrent} />);
        }

        for (let start = 0; start < members.rows.length; start += GROUP_DETAIL_CHUNK_SIZE) {
            const chunk = members.rows.slice(start, start + GROUP_DETAIL_CHUNK_SIZE);
            const first = start === 0;
            const last = start + GROUP_DETAIL_CHUNK_SIZE >= members.rows.length;
            add(`members:${chunk[0]!.membershipId}`, () => (
                <ItemGroup
                    title={first ? t('teams.groups.membersSection') : undefined}
                    footer={last ? notice ?? undefined : undefined}
                    virtualizedSegment={{ first, last }}
                >
                    {chunk.map((member) => {
                        const displayName = formatAccountDisplayName(member.account) ?? member.accountId;
                        const external = contributionLabel(member);
                        const isNative = member.contributions.native;
                        return (
                            <Item
                                key={member.membershipId}
                                testID={`team-group-member:${member.accountId}`}
                                title={displayName}
                                subtitle={external ?? undefined}
                                leftElement={(
                                    <Avatar
                                        id={member.accountId}
                                        size={MEMBER_AVATAR_SIZE}
                                        imageUrl={member.account.avatarUrl}
                                    />
                                )}
                                // An external-only row is not read-only: a native
                                // contribution can be added so the person keeps
                                // Group access if that source stops supplying them.
                                detail={isNative ? undefined : t('teams.groups.addMember')}
                                disabled={!canEditRoster}
                                rightElement={(
                                    <ItemRowActions
                                        title={displayName}
                                        actions={[
                                            {
                                                id: 'open-member-detail',
                                                title: t('common.open'),
                                                icon: 'arrow-square-out',
                                                inlineTestID: 'open-member-detail',
                                                onPress: () => router.push(teamGroupMemberDetailPath(
                                                    context.address,
                                                    member.membershipId,
                                                    groupId,
                                                    member.accountId,
                                                )),
                                            },
                                            ...member.contributions.external.map((contribution) => ({
                                                id: `open-external-source:${contribution.bindingId}`,
                                                title: `${t('common.open')}: ${contribution.label}`,
                                                icon: 'arrow-square-out' as const,
                                                inlineTestID: `open-external-source:${contribution.bindingId}`,
                                                onPress: () => router.push(contribution.owner.kind === 'directory_source'
                                                    ? teamDirectorySourcePath(
                                                        context.address,
                                                        contribution.owner.directorySourceId,
                                                    )
                                                    : teamIdentityConnectionPath(
                                                        context.address,
                                                        contribution.owner.teamIdentityConnectionId,
                                                    )),
                                            })),
                                        ]}
                                        compactActionIds={['open-member-detail']}
                                        overflowTriggerTestID={`team-group-member-actions:${member.accountId}`}
                                        overflowTriggerAccessibilityLabel={t('common.open')}
                                    />
                                )}
                                rightElementOutsidePressable
                                onPress={canEditRoster
                                    ? async () => {
                                        if (!isNative) {
                                            await addNative(member);
                                            return;
                                        }
                                        // What is being confirmed is this
                                        // person's removal from this Group —
                                        // not the Group's archive, whose copy
                                        // promises a retention and a restoration
                                        // this operation does not have.
                                        const confirmed = await Modal.confirm(
                                            t('teams.groups.removeMemberTitle', {
                                                name: displayName,
                                                group: group.name,
                                            }),
                                            external
                                                ? t('teams.groups.externalOnlyBody', { source: external })
                                                : t('teams.groups.removeMemberBody', {
                                                    name: displayName,
                                                    group: group.name,
                                                }),
                                            { confirmText: t('teams.groups.removeNative'), destructive: true },
                                        );
                                        if (!confirmed) return;
                                        await runRosterChange(
                                            () => removeTeamGroupMember({
                                                scope: context.scope,
                                                address: context.address,
                                                groupId,
                                                accountId: member.accountId,
                                                // `contribution_removed` is not
                                                // `removed`; an approved removal
                                                // owes that distinction too.
                                                onApprovalSucceeded: (result) =>
                                                    settleRosterChange(result, external),
                                                onApprovalFailed: () =>
                                                    setNotice(t('teams.errors.generic')),
                                            }),
                                            external,
                                        );
                                    }
                                    : undefined}
                                showChevron={false}
                            />
                        );
                    })}
                </ItemGroup>
            ));
        }

        if (members.rows.length === 0 && members.status === 'ready') {
            add('members-empty', () => (
                <ItemGroup footer={notice ?? t('teams.groups.emptyBody')}>
                    <Item testID="team-group-members-empty" title={t('teams.groups.emptyRosterTitle')} showChevron={false} />
                </ItemGroup>
            ));
        }

        const membersError = members.error;
        if (membersError) {
            add('members-error', () => (
                <ItemGroup footer={teamReadFailureLabel(membersError)}>
                    {membersError.retryable ? (
                        <Item
                            testID="team-group-members-retry"
                            title={t('teams.unavailable.retry')}
                            icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                            onPress={() => void members.reload()}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ));
        } else if (members.hasMore && members.rows.length > 0) {
            add('members-load-more', () => (
                <ItemGroup>
                    <Item
                        testID="team-group-members-load-more"
                        title={t('homeGovernance.loadMore')}
                        loading={members.status === 'loading_more'}
                        disabled={members.status === 'loading_more'}
                        onPress={() => void members.loadMore()}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (canEditRoster) {
            add('add-member', () => (
                <ItemGroup>
                    <Item
                        testID="team-group-add-member"
                        title={t('teams.groups.addMember')}
                        accessibilityExpanded={picking}
                        onPress={() => setPicking((current) => !current)}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (picking) {
            add('history', () => (
                    // The Group's own history intent, asked once for the add.
                    <ItemGroup
                        title={t('teams.history.label')}
                        footer={t('teams.history.scopeNote')}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('teams.history.label')}
                    >
                        <Item
                            testID="team-group-history:from_membership"
                            title={t('teams.history.fromMembershipNamed', { name: group.name })}
                            selected={groupHistoryAccess === 'from_membership'}
                            accessibilityRole="radio"
                            webRole="radio"
                            accessibilityChecked={groupHistoryAccess === 'from_membership'}
                            onPress={() => setGroupHistoryAccess('from_membership')}
                            showChevron={false}
                        />
                        <Item
                            testID="team-group-history:all_existing"
                            title={t('teams.history.allExistingNamed', { name: group.name })}
                            selected={groupHistoryAccess === 'all_existing'}
                            accessibilityRole="radio"
                            webRole="radio"
                            accessibilityChecked={groupHistoryAccess === 'all_existing'}
                            onPress={() => setGroupHistoryAccess('all_existing')}
                            showChevron={false}
                        />
                    </ItemGroup>
            ));

            for (let start = 0; start < eligibleCandidates.length; start += GROUP_DETAIL_CHUNK_SIZE) {
                const chunk = eligibleCandidates.slice(start, start + GROUP_DETAIL_CHUNK_SIZE);
                const first = start === 0;
                const last = start + GROUP_DETAIL_CHUNK_SIZE >= eligibleCandidates.length;
                add(`candidates:${chunk[0]!.id}`, () => (
                    <ItemGroup
                        title={first ? t('teams.members.personLabel') : undefined}
                        virtualizedSegment={{ first, last }}
                    >
                        {chunk.map((membership) => (
                                <Item
                                    key={membership.id}
                                    testID={`team-group-candidate:${membership.accountId}`}
                                    title={formatAccountDisplayName(membership.account) ?? membership.accountId}
                                    leftElement={(
                                        <Avatar
                                            id={membership.accountId}
                                            size={MEMBER_AVATAR_SIZE}
                                            imageUrl={membership.account.avatarUrl}
                                        />
                                    )}
                                    disabled={!canEditRoster}
                                    onPress={async () => {
                                        setPicking(false);
                                        await addNative({
                                            accountId: membership.accountId,
                                            membershipId: membership.id,
                                        });
                                    }}
                                    showChevron={false}
                                />
                            ))}
                    </ItemGroup>
                ));
            }

            if (!nativeRosterReady
                || (candidates.status === 'loading' && candidates.rows.length === 0)) {
                add('candidates-loading', () => (
                    <ItemGroup title={eligibleCandidates.length === 0 ? t('teams.members.personLabel') : undefined}>
                            <Item
                                testID="team-group-candidates-loading"
                                title={t('teams.members.personLabel')}
                                loading
                                showChevron={false}
                            />
                    </ItemGroup>
                ));
            }

            const candidatesError = candidates.error;
            if (candidatesError) {
                add('candidates-error', () => (
                    <ItemGroup title={eligibleCandidates.length === 0 ? t('teams.members.personLabel') : undefined}>
                        {candidatesError.retryable ? (
                                <Item
                                    testID="team-group-candidates-retry"
                                    title={t('teams.unavailable.retry')}
                                    subtitle={teamReadFailureLabel(candidatesError)}
                                    icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                                    onPress={() => void candidates.reload()}
                                    showChevron={false}
                                />
                            ) : (
                                <Item
                                    testID="team-group-candidates-unavailable"
                                    title={teamReadFailureLabel(candidatesError)}
                                    showChevron={false}
                                />
                            )}
                    </ItemGroup>
                ));
            }

            if (nativeRosterReady && candidates.status === 'ready' && eligibleCandidates.length === 0) {
                add('candidates-empty', () => (
                    <ItemGroup title={t('teams.members.personLabel')}>
                                <Item
                                    testID="team-group-candidates-empty"
                                    mode="info"
                                    title={t('teams.groups.noEligibleCandidatesTitle')}
                                    subtitle={t('teams.groups.noEligibleCandidatesBody')}
                                    showChevron={false}
                                />
                    </ItemGroup>
                ));
            }

            // The Team roster is paged; a Group add must be able to reach a
            // member who is not on its first page.
            if (candidates.status !== 'loading' && candidates.hasMore) {
                add('candidates-load-more', () => (
                        <ItemGroup>
                            <Item
                                testID="team-group-candidates-load-more"
                                title={t('homeGovernance.loadMore')}
                                loading={candidates.status === 'loading_more'}
                                disabled={candidates.status === 'loading_more'}
                                onPress={() => void candidates.loadMore()}
                                showChevron={false}
                            />
                        </ItemGroup>
                ));
            }
        }

        if (group.capabilities.archive && !archived) {
            add('archive', () => (
                <ItemGroup>
                    <Item
                        testID="team-group-archive"
                        title={t('teams.groups.archiveAction', { name: group.name })}
                        destructive
                        disabled={busy || !context.canMutate || !groupCurrent}
                        onPress={async () => {
                            if (mutationInFlightRef.current) return;
                            mutationInFlightRef.current = true;
                            const confirmed = await Modal.confirm(
                                t('teams.groups.archiveTitle', { name: group.name }),
                                t('teams.groups.archiveBody'),
                                { confirmText: t('teams.groups.archiveAction', { name: group.name }), destructive: true },
                            );
                            if (!confirmed) {
                                mutationInFlightRef.current = false;
                                return;
                            }
                            setBusy(true);
                            try {
                                const outcome = await archiveTeamGroup({
                                    scope: context.scope,
                                    address: context.address,
                                    groupId,
                                });
                                if (outcome.kind === 'succeeded') router.back();
                                else {
                                    setNotice(teamMutationFailureLabel(outcome.failure));
                                    if (outcome.failure.kind === 'outcome_unknown') void detail.reload();
                                }
                            } catch (cause) {
                                if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
                                else setNotice(t('teams.errors.generic'));
                            } finally {
                                mutationInFlightRef.current = false;
                                setBusy(false);
                            }
                        }}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (group.capabilities.restore && archived) {
            add('restore', () => (
                <ItemGroup>
                    <Item
                        testID="team-group-restore"
                        title={t('teams.groups.restoreAction', { name: group.name })}
                        // Restore is legitimate *because* the Group is archived,
                        // so it gates on host readiness rather than on the
                        // ordinary-write rule — but an unresolved approval for
                        // this exact restore is still custody the shell holds,
                        // and offering the control again would request one
                        // restore twice. Same expression as the Team's own
                        // restore in `TeamSettingsScreen`.
                        disabled={busy
                            || !context.mutationsAvailable
                            || context.approvalPending
                            || !groupCurrent}
                        onPress={async () => {
                            if (mutationInFlightRef.current) return;
                            mutationInFlightRef.current = true;
                            setBusy(true);
                            try {
                                const outcome = await restoreTeamGroup({
                                    scope: context.scope,
                                    address: context.address,
                                    groupId,
                                });
                                if (outcome.kind === 'failed') {
                                    setNotice(teamMutationFailureLabel(outcome.failure));
                                    if (outcome.failure.kind === 'outcome_unknown') void detail.reload();
                                }
                            } catch (cause) {
                                if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
                                else setNotice(t('teams.errors.generic'));
                            } finally {
                                mutationInFlightRef.current = false;
                                setBusy(false);
                            }
                        }}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        return result;
    }, [
        addNative,
        archived,
        busy,
        canEditRoster,
        candidates,
        context,
        detail,
        eligibleCandidates,
        group,
        groupCurrent,
        groupHistoryAccess,
        groupId,
        groupStale,
        managedBy,
        members,
        notice,
        picking,
        router,
        runRosterChange,
        theme.colors.state.warning.foreground,
        theme.colors.text.secondary,
    ]);

    const renderRow = React.useCallback(
        ({ item }: Readonly<{ item: GroupDetailVirtualizedRow }>) => item.render(),
        [],
    );

    if (group === null) {
        if (detail.status === 'loading') {
            return (
                <ItemGroup>
                    <Item testID="team-group-loading" title={t('teams.tabs.groups')} loading showChevron={false} />
                </ItemGroup>
            );
        }
        const failure = detail.error;
        const message = failure ? teamReadFailureLabel(failure) : t('teams.errors.notFound');
        return (
            <ItemGroup footer={message}>
                <Item testID="team-group-unavailable" title={message} showChevron={false} />
                {failure?.retryable ? (
                    <Item
                        testID="team-group-retry"
                        title={t('teams.unavailable.retry')}
                        onPress={() => void detail.reload()}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        );
    }

    return (
        <VirtualizedList
            testID="team-group-detail-virtualized-list"
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={props.header === undefined ? null : <>{props.header}</>}
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

export const TeamGroupDetailScreen = React.memo(function TeamGroupDetailScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    groupId: string;
}>) {
    return (
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            title={t('teams.tabs.groups')}
            presentation="virtualized-list"
        >
            {(context, header) => <GroupDetail context={context} groupId={props.groupId} header={header} />}
        </TeamSection>
    );
});
