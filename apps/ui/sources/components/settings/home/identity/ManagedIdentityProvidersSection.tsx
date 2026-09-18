import * as React from 'react';
import { useRouter } from 'expo-router';
import type { ManagedIdentityProviderV1 } from '@happier-dev/protocol';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import type { HomeAdministrationContext } from '../governance/homeAdministrationContext';
import {
    homeAdministrationIdentityProviderCreatePath,
    homeAdministrationIdentityProviderPath,
} from '../governance/homeAdministrationRoutes';
import { useManagedIdentityProviders } from './useManagedIdentityProviders';

export function managedIdentityProviderStatus(provider: ManagedIdentityProviderV1): string {
    if (!provider.enabled) return t('identityAdministration.disabled');
    if (provider.kind === 'github_app_identity') return t('identityAdministration.active');
    if (!provider.lastSuccessfulTest) return t('identityAdministration.needsTest');
    return provider.lastSuccessfulTest.current
        ? t('identityAdministration.tested')
        : t('identityAdministration.staleTest');
}

export const ManagedIdentityProvidersSection = React.memo(function ManagedIdentityProvidersSection(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const router = useRouter();
    const { state, refresh } = useManagedIdentityProviders(props.context.scope);

    if (state.kind === 'loading') {
        return (
            <ItemGroup title={t('identityAdministration.homeConnections')}>
                <Item title={t('common.loading')} leftElement={<ActivitySpinner />} showChevron={false} />
            </ItemGroup>
        );
    }

    if (state.kind === 'unavailable') {
        return (
            <ItemGroup title={t('identityAdministration.homeConnections')} footer={state.failure.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>
                <Item
                    testID="home-identity-providers-unavailable"
                    title={t('identityAdministration.error')}
                    detail={state.failure.retryable ? t('common.retry') : undefined}
                    onPress={state.failure.retryable ? refresh : undefined}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    return (
        <ItemGroup
            title={t('identityAdministration.homeConnections')}
            footer={state.stale
                ? t('homeGovernance.offlineNotice')
                : state.unreadableCount > 0
                    ? t('identityAdministration.unreadable')
                    : t('identityAdministration.subtitle')}
        >
            {state.items.length === 0 ? (
                <Item testID="home-identity-providers-empty" title={t('identityAdministration.empty')} showChevron={false} />
            ) : state.items.map((provider) => (
                <Item
                    key={provider.id}
                    testID={`home-identity-provider:${provider.id}`}
                    title={provider.displayName}
                    subtitle={provider.kind === 'oidc'
                        ? provider.config.issuer
                        : t('identityAdministration.githubFacetSignInSubtitle')}
                    detail={managedIdentityProviderStatus(provider)}
                    onPress={() => router.push(homeAdministrationIdentityProviderPath(
                        props.context.scope.serverId,
                        provider.id,
                    ))}
                />
            ))}
            <Item
                testID="home-identity-provider-add"
                title={t('identityAdministration.add')}
                disabled={!props.context.mutationsAvailable || state.refreshing || state.stale}
                onPress={props.context.mutationsAvailable && !state.refreshing && !state.stale
                    ? () => router.push(homeAdministrationIdentityProviderCreatePath(props.context.scope.serverId))
                    : undefined}
                showChevron={false}
            />
        </ItemGroup>
    );
});
