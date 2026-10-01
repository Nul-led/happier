import * as React from 'react';
import { useNavigation, useRouter } from '@/components/appShell/workspace/destinationRoute';
import {
    TEAM_NAME_MAX_LENGTH_V1,
    validateTeamDescriptionV1,
    validateTeamNameV1,
    type TeamAdmissionModeV1,
    type TeamExternalSharingPolicyV1,
    type TeamSessionCreationPolicyV1,
    type SessionHistoryAccessV1,
} from '@happier-dev/protocol/teams';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionButtonRow } from '@/components/ui/lists/SectionButtonRow';
import { Modal } from '@/modal';
import {
    archiveTeam,
    removeTeamLogo,
    restoreTeam,
    setTeamLogo,
    setTeamPolicy,
    updateTeam,
} from '@/sync/ops/teams/teamOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';
import { useUnsavedDraftNavigationGuard } from '@/utils/navigation/useUnsavedDraftNavigationGuard';

import { TeamSection } from './TeamSection';
import { TeamLogoPicker } from './TeamLogoPicker';
import type { TeamSectionContext } from './teamSectionContext';
import { teamMutationFailureLabel } from './teamMutationPresentation';
import { useEditedMetadataDraft } from './useEditedMetadataDraft';

const SESSION_CREATION_OPTIONS: readonly TeamSessionCreationPolicyV1[] = Object.freeze([
    'private_default',
    'team_default',
    'team_required',
]);

const EXTERNAL_SHARING_OPTIONS: readonly TeamExternalSharingPolicyV1[] = Object.freeze([
    'allowed',
    'team_admins_only',
    'disabled',
]);

const HISTORY_OPTIONS: readonly SessionHistoryAccessV1[] = Object.freeze([
    'from_membership',
    'all_existing',
]);

function sessionCreationLabel(policy: TeamSessionCreationPolicyV1): string {
    switch (policy) {
        case 'private_default':
            return t('teams.policy.sessionCreationPrivate');
        case 'team_default':
            return t('teams.policy.sessionCreationTeam');
        case 'team_required':
            return t('teams.policy.sessionCreationRequired');
    }
}

function externalSharingLabel(policy: TeamExternalSharingPolicyV1): string {
    switch (policy) {
        case 'allowed':
            return t('teams.policy.externalSharingAllowed');
        case 'team_admins_only':
            return t('teams.policy.externalSharingAdmins');
        case 'disabled':
            return t('teams.policy.externalSharingDisabled');
    }
}

function historyLabel(access: SessionHistoryAccessV1): string {
    return access === 'all_existing'
        ? t('teams.history.allExisting')
        : t('teams.history.fromMembership');
}

const TeamIdentitySection = React.memo(function TeamIdentitySection(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const { context } = props;
    const navigation = useNavigation();
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [saved, setSaved] = React.useState(false);
    const nameInputRef = React.useRef<React.ComponentRef<typeof FieldTextInput> | null>(null);
    const saveInFlightRef = React.useRef(false);

    React.useEffect(() => () => {
        saveInFlightRef.current = false;
    }, []);

    // The Home's answer stays authoritative while an unfinished draft survives a
    // refresh: the shared editor owner holds that decision for both this section
    // and the Group metadata section.
    const publishedName = context.team.name;
    const publishedDescription = context.team.description ?? '';
    const draft = useEditedMetadataDraft({ name: publishedName, description: publishedDescription });
    const { name, description, conflict } = draft;
    useUnsavedDraftNavigationGuard({
        navigation,
        isDirty: draft.isDirty,
        onDiscard: draft.reset,
        tag: 'TeamSettingsScreen.beforeRemove',
    });

    const nameValidation = validateTeamNameV1(name);
    const descriptionValidation = validateTeamDescriptionV1(description);
    const changed = nameValidation.status === 'ok'
        && descriptionValidation.status === 'ok'
        && (nameValidation.name !== publishedName
            || (descriptionValidation.description ?? '') !== publishedDescription);

    const save = React.useCallback(async () => {
        if (saveInFlightRef.current) return;
        if (nameValidation.status !== 'ok' || descriptionValidation.status !== 'ok') {
            if (nameValidation.status !== 'ok') nameInputRef.current?.focus();
            return;
        }
        saveInFlightRef.current = true;
        setSaving(true);
        setError(null);
        try {
            const outcome = await updateTeam({
                scope: context.scope,
                address: context.address,
                name: nameValidation.name,
                description: descriptionValidation.description,
            });
            if (outcome.kind === 'succeeded') {
                draft.commit({
                    name: outcome.team.name,
                    description: outcome.team.description ?? '',
                });
                setSaved(true);
                return;
            }
            setError(teamMutationFailureLabel(outcome.failure));
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
            else setError(t('teams.errors.generic'));
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
        }
    }, [context, draft, nameValidation, descriptionValidation]);

    const acceptCurrentBasis = React.useCallback(() => {
        draft.acceptPublished();
        setSaved(false);
    }, [draft]);

    const cancel = React.useCallback(() => {
        draft.reset();
        setError(null);
        setSaved(false);
    }, [draft]);

    const editable = context.team.capabilities.manageSettings && !context.archived;
    return (
        <>
            {/* Somebody else changed the Team while this draft was open: the Home's answer is
                shown, and continuing adopts it as the basis the draft is compared against. */}
            {conflict ? (
                <AttentionBanner
                    testID="team-settings-identity-conflict-notice"
                    title={t('teams.errors.conflict')}
                    description={[publishedName, publishedDescription].filter(Boolean).join('\n')}
                    accessibilityLiveRegion="assertive"
                    action={{
                        label: t('common.continue'),
                        onPress: acceptCurrentBasis,
                        disabled: saving,
                        testID: 'team-settings-identity-conflict',
                    }}
                />
            ) : null}
            <ItemGroup title={t('teams.create.detailsSection')}>
                <Item
                    title={t('teams.create.nameLabel')}
                    accessoryLayout="adaptive"
                    showChevron={false}
                    rightElement={(
                        <FieldTextInput
                            ref={nameInputRef}
                            testID="team-settings-name"
                            value={name}
                            onChangeText={(next) => { draft.setName(next); setSaved(false); }}
                            placeholder={t('teams.create.namePlaceholder')}
                            accessibilityLabel={t('teams.create.nameLabel')}
                            maxLength={TEAM_NAME_MAX_LENGTH_V1}
                            editable={editable}
                            error={nameValidation.status !== 'ok' ? t('teams.errors.invalidName') : null}
                        />
                    )}
                />
                <Item
                    title={t('teams.create.descriptionLabel')}
                    accessoryLayout="stacked"
                    showChevron={false}
                    rightElement={(
                        // Same contract as the Group forms: the canonical validator
                        // decides, and an overlong description says so instead of
                        // leaving a disabled Save with no explanation.
                        <FieldTextInput
                            testID="team-settings-description"
                            value={description}
                            onChangeText={(next) => { draft.setDescription(next); setSaved(false); }}
                            placeholder={t('teams.create.descriptionPlaceholder')}
                            accessibilityLabel={t('teams.create.descriptionLabel')}
                            multiline
                            minLines={2}
                            editable={editable}
                            error={descriptionValidation.status !== 'ok' ? t('teams.errors.invalidDescription') : null}
                        />
                    )}
                />
                <TeamLogoSection context={context} />
            </ItemGroup>
            <ItemGroup surface="none">
                    <SectionButtonRow
                        footnote={error ?? (saved && !changed ? t('teams.settings.saved') : null)}
                        footnoteTone={error ? 'danger' : 'secondary'}
                        footnoteTestID={error ? 'team-settings-identity-error' : 'team-settings-saved'}
                    >
                        <RoundButton
                            testID="team-settings-save"
                            size="small"
                            title={t('common.save')}
                            loading={saving}
                            disabled={!changed || conflict || saving || !context.canMutate}
                            onPress={() => void save()}
                        />
                        {changed || conflict ? (
                            <RoundButton
                                testID="team-settings-cancel"
                                size="small"
                                display="inverted"
                                title={t('common.cancel')}
                                disabled={saving}
                                onPress={cancel}
                            />
                        ) : null}
                    </SectionButtonRow>
            </ItemGroup>
        </>
    );
});

const TeamLogoSection = React.memo(function TeamLogoSection(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const { context } = props;
    const [error, setError] = React.useState<string | null>(null);
    const [removing, setRemoving] = React.useState(false);
    const removeInFlightRef = React.useRef(false);

    React.useEffect(() => () => {
        removeInFlightRef.current = false;
    }, []);

    const use = React.useCallback<React.ComponentProps<typeof TeamLogoPicker>['onUse']>(async (image, onSettled) => {
        try {
            const outcome = await setTeamLogo({
                scope: context.scope,
                address: context.address,
                image,
                onApprovalSucceeded: () => onSettled({ kind: 'succeeded' }),
                onApprovalFailed: (code) => onSettled({
                    kind: 'failed',
                    message: code === 'approval_rejected' ? t('teams.errors.forbidden') : t('teams.logo.failed'),
                }),
            });
            return outcome.kind === 'succeeded'
                ? { kind: 'succeeded' as const }
                : { kind: 'failed' as const, message: teamMutationFailureLabel(outcome.failure) };
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) {
                context.requestApproval(cause.registration);
                return { kind: 'pending' as const };
            }
            return { kind: 'failed' as const, message: t('teams.logo.failed') };
        }
    }, [context]);

    const remove = React.useCallback(async () => {
        if (removeInFlightRef.current) return;
        removeInFlightRef.current = true;
        const confirmed = await Modal.confirm(
            t('teams.logo.removeConfirmTitle'),
            t('teams.logo.removeConfirmBody'),
            { confirmText: t('teams.logo.remove'), destructive: true },
        );
        if (!confirmed) {
            removeInFlightRef.current = false;
            return;
        }
        setRemoving(true);
        setError(null);
        try {
            const outcome = await removeTeamLogo({
                scope: context.scope,
                address: context.address,
            });
            if (outcome.kind === 'failed') setError(teamMutationFailureLabel(outcome.failure));
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
            else setError(t('teams.logo.failed'));
        } finally {
            removeInFlightRef.current = false;
            setRemoving(false);
        }
    }, [context]);

    return (
        <TeamLogoPicker
            identityId={context.address.teamId}
            testIDPrefix="team-settings"
            currentLogo={context.team.logo}
            disabled={!context.team.capabilities.manageSettings || !context.canMutate || removing}
            onUse={use}
            remove={{
                onPress: () => void remove(),
                busy: removing,
                disabled: !context.canMutate || removing,
                error,
            }}
        />
    );
});

const TeamPolicySections = React.memo(function TeamPolicySections(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const { context } = props;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const operationInFlightRef = React.useRef(false);
    const { policy } = context.team;

    React.useEffect(() => () => {
        operationInFlightRef.current = false;
    }, []);

    const canEdit = context.team.capabilities.managePolicy && context.canMutate && !busy;

    const patch = React.useCallback(async (
        next: Parameters<typeof setTeamPolicy>[0] extends infer P
            ? Omit<Extract<P, object>, 'scope' | 'address'>
            : never,
    ) => {
        if (operationInFlightRef.current) return;
        operationInFlightRef.current = true;
        setBusy(true);
        setError(null);
        let outcome: Awaited<ReturnType<typeof setTeamPolicy>>;
        try {
            outcome = await setTeamPolicy({ scope: context.scope, address: context.address, ...next });
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
            else setError(t('teams.errors.generic'));
            operationInFlightRef.current = false;
            setBusy(false);
            return;
        }
        operationInFlightRef.current = false;
        setBusy(false);
        if (outcome.kind === 'failed') setError(teamMutationFailureLabel(outcome.failure));
    }, [context]);

    return (
        <>
            {error ? (
                <AttentionBanner
                    testID="team-settings-policy-error"
                    title={t('homeGovernance.changeFailedTitle')}
                    description={error}
                    accessibilityLiveRegion="assertive"
                />
            ) : null}
            <ItemGroup
                title={t('teams.settings.sessionDefaultsSection')}
                description={t('teams.policy.sessionCreationHelp')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.settings.sessionDefaultsSection')}
            >
                {SESSION_CREATION_OPTIONS.map((option) => (
                    <Item
                        key={option}
                        testID={`team-settings-session-creation:${option}`}
                        title={sessionCreationLabel(option)}
                        selected={option === policy.sessionCreationPolicy}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={option === policy.sessionCreationPolicy}
                        disabled={!canEdit}
                        onPress={() => void patch({ sessionCreationPolicy: option })}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            <ItemGroup
                title={t('teams.settings.externalSharingSection')}
                description={t('teams.policy.externalSharingHelp')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.settings.externalSharingSection')}
            >
                {EXTERNAL_SHARING_OPTIONS.map((option) => (
                    <Item
                        key={option}
                        testID={`team-settings-external-sharing:${option}`}
                        title={externalSharingLabel(option)}
                        selected={option === policy.externalSharingPolicy}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={option === policy.externalSharingPolicy}
                        disabled={!canEdit}
                        onPress={() => void patch({ externalSharingPolicy: option })}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            <ItemGroup
                title={t('teams.settings.historyDefaultSection')}
                description={t('teams.policy.historyDefaultHelp')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.settings.historyDefaultSection')}
            >
                {HISTORY_OPTIONS.map((option) => (
                    <Item
                        key={option}
                        testID={`team-settings-history-default:${option}`}
                        title={historyLabel(option)}
                        selected={option === policy.defaultSessionHistoryAccess}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={option === policy.defaultSessionHistoryAccess}
                        disabled={!canEdit}
                        onPress={() => void patch({ defaultSessionHistoryAccess: option })}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
        </>
    );
});

const TeamLifecycleSection = React.memo(function TeamLifecycleSection(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const router = useRouter();
    const { context } = props;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const lifecycleInFlightRef = React.useRef(false);
    const name = context.team.name;

    React.useEffect(() => () => {
        lifecycleInFlightRef.current = false;
    }, []);

    const archive = React.useCallback(async () => {
        if (lifecycleInFlightRef.current) return;
        lifecycleInFlightRef.current = true;
        const confirmed = await Modal.confirm(
            t('teams.archive.confirmTitle', { name }),
            t('teams.archive.confirmBody', { name }),
            // Destructive styling appears only at the final confirmation.
            { confirmText: t('teams.archive.action', { name }), destructive: true },
        );
        if (!confirmed) {
            lifecycleInFlightRef.current = false;
            return;
        }
        setBusy(true);
        setError(null);
        let outcome: Awaited<ReturnType<typeof archiveTeam>>;
        try {
            outcome = await archiveTeam({
                scope: context.scope,
                address: context.address,
            });
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
            else setError(t('teams.errors.generic'));
            setBusy(false);
            lifecycleInFlightRef.current = false;
            return;
        }
        setBusy(false);
        lifecycleInFlightRef.current = false;
        if (outcome.kind === 'failed') { setError(teamMutationFailureLabel(outcome.failure)); return; }
        router.back();
    }, [context, name, router]);

    const restore = React.useCallback(async () => {
        if (lifecycleInFlightRef.current) return;
        lifecycleInFlightRef.current = true;
        const confirmed = await Modal.confirm(
            t('teams.archive.restoreTitle', { name }),
            t('teams.archive.restoreBody'),
            { confirmText: t('teams.archive.restoreAction', { name }) },
        );
        if (!confirmed) {
            lifecycleInFlightRef.current = false;
            return;
        }
        setBusy(true);
        setError(null);
        let outcome: Awaited<ReturnType<typeof restoreTeam>>;
        try {
            outcome = await restoreTeam({
                scope: context.scope,
                address: context.address,
            });
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.artifactId);
            else setError(t('teams.errors.generic'));
            setBusy(false);
            lifecycleInFlightRef.current = false;
            return;
        }
        setBusy(false);
        lifecycleInFlightRef.current = false;
        if (outcome.kind === 'failed') setError(teamMutationFailureLabel(outcome.failure));
    }, [context, name]);

    // Restore stays reachable from the archived Team; archive does not.
    const showArchive = context.team.capabilities.archiveTeam && !context.archived;
    const showRestore = context.team.capabilities.restoreTeam && context.archived;
    if (!showArchive && !showRestore) return null;

    return (
        <ItemGroup
            title={t('teams.settings.lifecycleSection')}
            description={showArchive ? t('teams.settings.archiveDescription') : t('teams.archive.readOnly')}
            surface="none"
        >
            <SectionButtonRow footnote={error} footnoteTone="danger" footnoteTestID="team-settings-lifecycle-error">
                {showArchive ? (
                    <RoundButton
                        testID="team-settings-archive"
                        size="small"
                        display="destructive"
                        title={t('teams.archive.action', { name })}
                        titleNumberOfLines="complete"
                        loading={busy}
                        disabled={busy || !context.canMutate}
                        onPress={() => void archive()}
                    />
                ) : null}
                {showRestore ? (
                    <RoundButton
                        testID="team-settings-restore"
                        size="small"
                        display="secondary"
                        title={t('teams.archive.restoreAction', { name })}
                        titleNumberOfLines="complete"
                        loading={busy}
                        disabled={busy || !context.mutationsAvailable || context.approvalPending}
                        onPress={() => void restore()}
                    />
                ) : null}
            </SectionButtonRow>
        </ItemGroup>
    );
});

export const TeamSettingsScreen = React.memo(function TeamSettingsScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    return (
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            title={t('teams.tabs.settings')}
            description={t('teams.pages.settings')}
            restoresHere
        >
            {(context) => (
                <>
                    {/* The Team section carries the logo row with the name and description. */}
                    {context.team.capabilities.manageSettings ? <TeamIdentitySection context={context} /> : null}
                    {context.team.capabilities.managePolicy ? (
                        <TeamPolicySections context={context} />
                    ) : null}
                    <TeamLifecycleSection context={context} />
                </>
            )}
        </TeamSection>
    );
});
