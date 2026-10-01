import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import type { ManagedIdentityProviderV1 } from '@happier-dev/protocol';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { SettingAnchor, SettingSection } from '@/components/settings/shell/SettingRow';
import { HOME_SIGN_IN_PROVIDERS_SETTINGS } from '../signInProviders/homeSignInProvidersSettings';
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
    props: Readonly<{
        context: HomeAdministrationContext;
        /** Read-only rows the deployment itself provides (its OIDC file, WorkOS), after the Home's own. */
        deploymentRows?: React.ReactNode;
    }>,
) {
    const router = useRouter();
    const { state, refresh } = useManagedIdentityProviders(
        props.context.scope,
        { kind: 'home' },
        props.context.requestApproval,
    );

    if (state.kind === 'loading') {
        return (
            <SettingSection section={HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs.homeConnections}><ItemGroup title={t('identityAdministration.homeConnections')}>
                <Item title={t('common.loading')} leftElement={<ActivitySpinner />} showChevron={false} />
                {props.deploymentRows}
            </ItemGroup></SettingSection>
        );
    }

    if (state.kind === 'unavailable') {
        return (
            <SettingSection section={HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs.homeConnections}><ItemGroup title={t('identityAdministration.homeConnections')} description={state.failure.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>
                <Item
                    testID="home-identity-providers-unavailable"
                    title={t('identityAdministration.error')}
                    detail={state.failure.retryable ? t('common.retry') : undefined}
                    onPress={state.failure.retryable ? refresh : undefined}
                    showChevron={false}
                />
                {props.deploymentRows}
            </ItemGroup></SettingSection>
        );
    }

    const mayAdd = props.context.mutationsAvailable && !state.refreshing && !state.stale;
    return (
        <SettingAnchor setting={HOME_SIGN_IN_PROVIDERS_SETTINGS.settings.homeConnections}><ItemGroup
            title={t('identityAdministration.homeConnections')}
            action={(
                <SettingAnchor setting={HOME_SIGN_IN_PROVIDERS_SETTINGS.settings.addProvider}><SectionActionButton
                    testID="home-identity-provider-add"
                    icon="plus"
                    title={t('identityAdministration.add')}
                    disabled={!mayAdd}
                    onPress={() => router.push(homeAdministrationIdentityProviderCreatePath(props.context.scope.serverId))}
                /></SettingAnchor>
            )}
            description={state.stale
                ? t('homeGovernance.offlineNotice')
                : state.unreadableCount > 0
                    ? t('identityAdministration.unreadable')
                    : t('identityAdministration.subtitle')}
        >
            {state.items.length === 0 && !props.deploymentRows ? (
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
            {props.deploymentRows}
        </ItemGroup></SettingAnchor>
    );
});
