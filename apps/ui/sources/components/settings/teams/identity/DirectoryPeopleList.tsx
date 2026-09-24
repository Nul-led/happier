import * as React from 'react';
import { useRouter } from 'expo-router';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useTeamPagedList } from '@/hooks/teams/useTeamPagedList';
import { TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 } from '@happier-dev/protocol';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';
import { t } from '@/text';

import { teamMemberDetailPath } from '../teamsRoutes';
import { createIdentityAdministrationClient } from './identityAdministrationClient';

export function useDirectoryPeopleList(props: Readonly<{
    scope: ServerAccountScope;
    address: TeamAddress;
    sourceId: string;
    enabled?: boolean;
}>) {
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope),
        [props.scope.accountId, props.scope.serverId],
    );
    const loadPage = React.useCallback(async (cursor: string | null) => {
        const result = await client.executeDirectory('teams.directory.people.list', {
            v: 1,
            teamId: props.address.teamId,
            sourceId: props.sourceId,
            limit: 50,
            cursor,
        });
        return result.ok
            ? { kind: 'succeeded' as const, value: result.value }
            : {
                kind: 'failed' as const,
                failure: { kind: 'unknown' as const, retryable: result.failure.retryable, code: null },
            };
    }, [client, props.address.teamId, props.sourceId]);
    return useTeamPagedList({
        key: `${props.scope.serverId} ${props.scope.accountId} ${props.address.teamId} ${props.sourceId}`,
        enabled: props.enabled ?? true,
        loadPage,
        // Directory projection changes are published as the Team change.
        accountChange: { serverId: props.address.serverId, entityId: TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 },
    });
}

export const DirectoryPeopleList = React.memo(function DirectoryPeopleList(props: Readonly<{
    scope: ServerAccountScope;
    address: TeamAddress;
    sourceId: string;
}>) {
    const router = useRouter();
    const people = useDirectoryPeopleList(props);

    return (
        <>
            <ItemGroup title={t('teams.authentication.directory.people.section')}>
                {people.status === 'loading' && people.rows.length === 0 ? (
                    <Item title={t('common.loading')} loading showChevron={false} />
                ) : people.rows.length === 0 ? (
                    <Item title={t('teams.authentication.directory.people.empty')} showChevron={false} />
                ) : people.rows.map((person) => {
                    const membershipId = person.accountBinding.state === 'bound'
                        ? person.accountBinding.teamMembershipId
                        : null;
                    const stateLabel = person.state === 'active'
                        ? null
                        : t(`teams.authentication.directory.people.state.${person.state}`);
                    const identityLabel = person.email ?? person.externalLogin;
                    return (
                        <Item
                            key={person.id}
                            testID={`directory-person:${person.id}`}
                            title={person.displayName ?? identityLabel ?? t('teams.authentication.directory.people.unknown')}
                            subtitle={[identityLabel, stateLabel].filter((value): value is string => value !== null).join(' · ') || undefined}
                            detail={person.accountBinding.state === 'unbound'
                                ? t('teams.authentication.directory.people.provisioned')
                                : t('teams.authentication.directory.people.member')}
                            onPress={membershipId === null
                                ? undefined
                                : () => router.push(teamMemberDetailPath(props.address, membershipId))}
                            showChevron={membershipId !== null}
                        />
                    );
                })}
            </ItemGroup>
            {people.error ? (
                <ItemGroup footer={people.error.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>
                    {people.error.retryable ? (
                        <Item
                            testID="directory-people-retry"
                            title={t('common.retry')}
                            onPress={() => void people.reload()}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}
            {people.hasMore ? (
                <ItemGroup>
                    <Item
                        testID="directory-people-load-more"
                        title={t('teams.authentication.directory.people.loadMore')}
                        loading={people.status === 'loading_more'}
                        disabled={people.status === 'loading_more'}
                        onPress={() => void people.loadMore()}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
        </>
    );
});
