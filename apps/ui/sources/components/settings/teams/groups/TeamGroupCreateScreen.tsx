import * as React from 'react';
import { useRouter } from 'expo-router';
import {
    TEAM_GROUP_NAME_MAX_LENGTH_V1,
    validateTeamGroupDescriptionV1,
    validateTeamGroupNameV1,
} from '@happier-dev/protocol/teams';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { randomUUID } from '@/platform/randomUUID';
import { createTeamGroup } from '@/sync/ops/teams/teamGroupOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamMutationFailureLabel } from '../teamMutationPresentation';
import { teamGroupDetailPath } from '../teamsRoutes';

const CreateGroupForm = React.memo(function CreateGroupForm(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const router = useRouter();
    const { context } = props;
    const [name, setName] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const submitInFlightRef = React.useRef(false);

    React.useEffect(() => () => {
        submitInFlightRef.current = false;
    }, []);

    // One retry identity per submission; a lost response must not create two
    // Groups, and it is regenerated only when the payload changes.
    const requestKey = React.useRef(randomUUID());
    React.useEffect(() => {
        requestKey.current = randomUUID();
    }, [name, description]);

    const nameValidation = validateTeamGroupNameV1(name);
    const descriptionValidation = validateTeamGroupDescriptionV1(description);

    /**
     * One settlement for the immediate answer and the approved one. The Group's
     * id exists only in the Home's answer, so an approved creation opens the
     * Group it actually produced rather than degrading into "something changed".
     */
    const openCreatedGroup = React.useCallback((group: Readonly<{ id: string }>) => {
        router.replace(teamGroupDetailPath(context.address, group.id));
    }, [context.address, router]);

    const submit = React.useCallback(async () => {
        if (submitInFlightRef.current
            || nameValidation.status !== 'ok'
            || descriptionValidation.status !== 'ok') return;
        submitInFlightRef.current = true;
        setSubmitting(true);
        setError(null);
        let outcome: Awaited<ReturnType<typeof createTeamGroup>>;
        try {
            outcome = await createTeamGroup({
                scope: context.scope,
                address: context.address,
                name: nameValidation.name,
                description: descriptionValidation.description,
                requestKey: requestKey.current,
                onApprovalSucceeded: openCreatedGroup,
                onApprovalFailed: () => setError(t('teams.errors.generic')),
            });
        } catch (cause) {
            submitInFlightRef.current = false;
            setSubmitting(false);
            if (isTeamActionApprovalPendingError(cause)) {
                // The creation was deferred, not lost. Registering this exact
                // request is what lets its approved answer open the new Group
                // here; settlement never redispatches, because the Home creates
                // the Group when the approval is granted.
                context.requestApproval(cause.registration);
            } else {
                setError(t('teams.errors.generic'));
            }
            return;
        }
        submitInFlightRef.current = false;
        setSubmitting(false);
        if (outcome.kind === 'succeeded') {
            openCreatedGroup(outcome.value);
            return;
        }
        // A name collision inside this Team is the one failure worth naming
        // precisely; the form is preserved either way.
        setError(outcome.failure.kind === 'conflict'
            ? t('teams.groups.nameTaken')
            : outcome.failure.kind === 'invalid'
                ? t('teams.errors.invalidName')
                : teamMutationFailureLabel(outcome.failure));
    }, [context, nameValidation, descriptionValidation, openCreatedGroup]);

    if (!context.team.capabilities.manageGroups) {
        return (
            <ItemGroup footer={t('teams.errors.forbidden')}>
                <Item testID="team-group-create-forbidden" title={t('homeGovernance.forbiddenTitle')} showChevron={false} />
            </ItemGroup>
        );
    }

    return (
        <>
            <ItemGroup
                title={t('teams.groups.createTitle', { team: context.team.name })}
                footer={t('teams.groups.emptyBody')}
            >
                <TextInput
                    testID="team-group-create-name"
                    value={name}
                    onChangeText={setName}
                    placeholder={t('teams.groups.namePlaceholder')}
                    accessibilityLabel={t('teams.groups.nameLabel')}
                    maxLength={TEAM_GROUP_NAME_MAX_LENGTH_V1}
                />
                <TextInput
                    testID="team-group-create-description"
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('teams.create.descriptionPlaceholder')}
                    accessibilityLabel={t('teams.create.descriptionLabel')}
                    multiline
                />
            </ItemGroup>

            <ItemGroup footer={error ?? undefined}>
                <Item
                    testID="team-group-create-submit"
                    title={t('teams.groups.submit')}
                    loading={submitting}
                    disabled={nameValidation.status !== 'ok' || submitting || !context.canMutate}
                    onPress={() => void submit()}
                    showChevron={false}
                />
            </ItemGroup>
        </>
    );
});

export const TeamGroupCreateScreen = React.memo(function TeamGroupCreateScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('teams.groups.create')}>
            {(context) => <CreateGroupForm context={context} />}
        </TeamSection>
    );
});
