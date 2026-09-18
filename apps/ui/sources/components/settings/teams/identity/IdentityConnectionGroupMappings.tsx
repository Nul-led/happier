import * as React from 'react';

import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { useTeamGroups } from '@/hooks/teams/useTeamGroups';
import { useTeamPagedList } from '@/hooks/teams/useTeamPagedList';
import { Modal } from '@/modal';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';
import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { t } from '@/text';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';

import { buildIdentityConnectionGroupMappingCommand } from './identityConnectionGroupMapping';
import { createIdentityAdministrationClient } from './identityAdministrationClient';

export const IdentityConnectionGroupMappings = React.memo(function IdentityConnectionGroupMappings(props: Readonly<{
    scope: Parameters<typeof createIdentityAdministrationClient>[0];
    address: TeamAddress;
    connectionId: string;
    mutationsAvailable: boolean;
    requestApproval: (registration: ActionApprovalRegistration) => void;
}>) {
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope, {
            onApprovalPending: props.requestApproval,
        }),
        [props.requestApproval, props.scope.accountId, props.scope.serverId],
    );
    const [externalGroupId, setExternalGroupId] = React.useState('');
    const [choosingTarget, setChoosingTarget] = React.useState(false);
    const [pending, setPending] = React.useState<string | null>(null);
    const [failure, setFailure] = React.useState<string | null>(null);

    // A typed Home outcome becomes one localized sentence, announced as well as
    // shown because it lands away from the control that was pressed.
    const reportFailure = React.useCallback((code: string) => {
        const message = identityAdministrationFailureMessage(code);
        setFailure(message);
        announceAccessibilityMessage(message);
    }, []);
    const loadPage = React.useCallback(async (cursor: string | null) => {
        const result = await client.executeExternalGroupBinding('teams.externalGroupBindings.list', {
            v: 1, teamId: props.address.teamId, ownerKind: 'identity_connection',
            teamIdentityConnectionId: props.connectionId, limit: 50, cursor,
        });
        return result.ok
            ? { kind: 'succeeded' as const, value: { items: result.value.items, nextCursor: result.value.nextCursor } }
            : { kind: 'failed' as const, failure: { kind: 'unknown' as const, retryable: result.failure.retryable, code: null } };
    }, [client, props.address.teamId, props.connectionId]);
    const bindings = useTeamPagedList({
        key: `${props.scope.serverId} ${props.scope.accountId} ${props.address.teamId} ${props.connectionId} identity-groups`,
        enabled: true,
        loadPage,
    });
    const nativeGroups = useTeamGroups({ scope: props.scope, address: props.address, archived: 'active', enabled: choosingTarget });
    const bind = React.useCallback(async (target: Parameters<typeof buildIdentityConnectionGroupMappingCommand>[0]['target']) => {
        const command = buildIdentityConnectionGroupMappingCommand({
            teamId: props.address.teamId, connectionId: props.connectionId, externalGroupId, target,
        });
        if (!command) { setFailure(t('identityAdministration.required')); return; }
        const finishBinding = async () => {
            setExternalGroupId('');
            setChoosingTarget(false);
            await bindings.reload();
        };
        setPending('create'); setFailure(null);
        try {
            const result = await client.executeExternalGroupBinding('teams.externalGroupBindings.set', command, {
                onApprovalSucceeded: finishBinding,
                onApprovalFailed: reportFailure,
            });
            if (!result.ok) {
                if (!('approvalPending' in result)) reportFailure(result.failure.code);
                return;
            }
            await finishBinding();
        } finally { setPending(null); }
    }, [bindings, client, externalGroupId, props.address.teamId, props.connectionId, reportFailure]);
    const remove = React.useCallback(async (binding: (typeof bindings.rows)[number]) => {
        if (!await Modal.confirm(t('identityAdministration.removeMapping'), binding.externalGroupId, {
            cancelText: t('common.cancel'), confirmText: t('identityAdministration.removeMapping'), destructive: true,
        })) return;
        const finishRemoval = async () => await bindings.reload();
        setPending(binding.id); setFailure(null);
        try {
            const result = await client.executeExternalGroupBinding('teams.externalGroupBindings.remove', {
                v: 1, teamId: props.address.teamId, bindingId: binding.id,
            }, {
                onApprovalSucceeded: finishRemoval,
                onApprovalFailed: reportFailure,
            });
            if (!result.ok) {
                if (!('approvalPending' in result)) reportFailure(result.failure.code);
            } else await finishRemoval();
        } finally { setPending(null); }
    }, [bindings, client, props.address.teamId, reportFailure]);
    return (
        <>
            <ItemGroup title={t('identityAdministration.directoryGroups')}>
                {bindings.status === 'loading' && bindings.rows.length === 0 ? <Item title={t('common.loading')} loading showChevron={false} /> : bindings.rows.length === 0 ? <Item title={t('identityAdministration.unmapped')} showChevron={false} /> : bindings.rows.map((binding) => (
                    <Item key={binding.id} testID={`identity-group-binding:${binding.id}`} title={binding.externalGroupId} subtitle={`${t('identityAdministration.mappedTo')}: ${binding.target.name}`} loading={pending === binding.id} disabled={pending !== null || !props.mutationsAvailable} onPress={() => void remove(binding)} showChevron={false} />
                ))}
                {bindings.hasMore ? <Item testID="identity-group-bindings-load-more" title={t('identityAdministration.loadMore')} loading={bindings.status === 'loading_more'} disabled={bindings.status === 'loading_more'} onPress={() => void bindings.loadMore()} showChevron={false} /> : null}
            </ItemGroup>
            <ItemGroup title={t('identityAdministration.chooseGroup')}>
                <FieldItem label={t('identityAdministration.directoryGroups')}><TextInput testID="identity-external-group-id" accessibilityLabel={t('identityAdministration.directoryGroups')} value={externalGroupId} editable={props.mutationsAvailable} onChangeText={setExternalGroupId} autoCapitalize="none" autoCorrect={false} /></FieldItem>
                <Item testID="identity-group-map-create" title={t('identityAdministration.mapCreate')} loading={pending === 'create'} disabled={pending !== null || !props.mutationsAvailable} onPress={() => void bind({ kind: 'directory_created' })} showChevron={false} />
                <Item testID="identity-group-map-existing" title={t('identityAdministration.mapExisting')} selected={choosingTarget} disabled={pending !== null || !props.mutationsAvailable} onPress={() => setChoosingTarget((value) => !value)} showChevron={false} />
                {choosingTarget ? nativeGroups.rows.map((group) => <Item key={group.id} testID={`identity-group-native-target:${group.id}`} title={group.name} subtitle={t('teams.groups.memberCount', { count: group.memberCount })} disabled={pending !== null || !props.mutationsAvailable} onPress={() => void bind({ kind: 'native_target', teamGroupId: group.id })} showChevron={false} />) : null}
                {choosingTarget && nativeGroups.hasMore ? <Item title={t('identityAdministration.loadMore')} loading={nativeGroups.status === 'loading_more'} disabled={nativeGroups.status === 'loading_more'} onPress={() => void nativeGroups.loadMore()} showChevron={false} /> : null}
            </ItemGroup>
            {bindings.error ? <ItemGroup footer={bindings.error.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>{bindings.error.retryable ? <Item testID="identity-group-bindings-retry" title={t('common.retry')} onPress={() => void bindings.reload()} showChevron={false} /> : null}</ItemGroup> : null}
            {failure ? <ItemGroup><Item testID="identity-group-mapping-failure" title={failure} showChevron={false} /></ItemGroup> : null}
        </>
    );
});
