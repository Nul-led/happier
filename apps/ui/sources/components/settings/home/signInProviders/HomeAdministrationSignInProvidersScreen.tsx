import * as React from 'react';
import type { HomeIdentityDeploymentServicesV1 } from '@happier-dev/protocol/home/governance';

import { SettingAnchor, SettingSection } from '@/components/settings/shell/SettingRow';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useHomeSettings } from '@/hooks/home/useHomeSettings';
import { t } from '@/text';

import { HomeAdministrationSection } from '../governance/HomeAdministrationSection';
import type { HomeAdministrationContext } from '../governance/homeAdministrationContext';
import {
    homeManagedGitHubAppCreatePath,
    homeManagedGitHubAppSurface,
    ManagedGitHubAppsSection,
} from '../githubApps/ManagedGitHubAppsSection';
import { ManagedIdentityProvidersSection } from '../identity/ManagedIdentityProvidersSection';
import {
    HomePrivateEndpointsSection,
    HomeTeamSignInRulesSection,
    PRIVATE_NETWORK_CEILING_KEY,
    workosDeploymentLabel,
} from './HomeSignInProviderPolicySections';
import { HOME_SIGN_IN_PROVIDERS_SETTINGS } from './homeSignInProvidersSettings';

const WORKOS_KEYS = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID'] as const;

/**
 * The rows the deployment itself contributes to Identity providers: its own OIDC providers (read
 * only, named with the key that declares them) and WorkOS, whose state the deployment decides.
 * Whether a key is locked by the deployment comes from the Home's configuration registry.
 */
const DeploymentIdentityRows = React.memo(function DeploymentIdentityRows(props: Readonly<{
    services: HomeIdentityDeploymentServicesV1;
    workosFixed: boolean;
}>) {
    const keys = WORKOS_KEYS.join(', ');
    return (
        <>
            {(props.services.deploymentOidcProviders ?? []).map((provider) => (
                <Item
                    key={provider.id}
                    testID={`home-sign-in-deployment-oidc:${provider.id}`}
                    title={provider.displayName}
                    subtitle={t('homeGovernance.signInProviders.fromDeployment', { key: provider.sourceKey })}
                    showChevron={false}
                />
            ))}
            <SettingAnchor setting={HOME_SIGN_IN_PROVIDERS_SETTINGS.settings.workos}><Item
                testID="home-sign-in-workos"
                title={t('identityAdministration.workos')}
                subtitle={props.workosFixed
                    ? t('homeGovernance.signInProviders.workosSetByDeployment', { keys })
                    : t('homeGovernance.signInProviders.workosSetInServerSettings', { keys })}
                detail={workosDeploymentLabel(props.services.workos)}
                showChevron={false}
            /></SettingAnchor>
        </>
    );
});

const SignInProvidersContent = React.memo(function SignInProvidersContent(props: Readonly<{
    context: HomeAdministrationContext;
}>) {
    const { context } = props;
    const services = context.projection.identityServices ?? null;
    const home = useHomeSettings(context.scope, services !== null);
    const entries = home.settings?.entries ?? null;
    const fixed = React.useCallback((key: string): boolean | null => {
        if (!entries) return null;
        return entries.find((entry) => entry.key === key)?.fixed ?? null;
    }, [entries]);
    const workosFixed = WORKOS_KEYS.some((key) => fixed(key) === true);

    return (
        <>
            <ManagedIdentityProvidersSection
                context={context}
                deploymentRows={services ? <DeploymentIdentityRows services={services} workosFixed={workosFixed} /> : undefined}
            />
            <ManagedGitHubAppsSection surface={homeManagedGitHubAppSurface(context)} createPath={homeManagedGitHubAppCreatePath(context)} />
            <SettingSection section={HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs.identityNetwork}>
                <HomePrivateEndpointsSection context={context} ceilingFixed={fixed(PRIVATE_NETWORK_CEILING_KEY)} />
            </SettingSection>
            <SettingSection section={HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs.teamProviders}>
                <HomeTeamSignInRulesSection context={context} />
            </SettingSection>
        </>
    );
});

/**
 * Sign-in providers (plan §3.13): the Home's identity providers and GitHub Apps, where managed
 * sign-in may reach, and what Teams may add. Setup, discovery and test sign-in are the existing
 * provider and App pages beneath it; Policies keeps the switches that turn a provider on for sign-in.
 */
export const HomeAdministrationSignInProvidersScreen = React.memo(function HomeAdministrationSignInProvidersScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection
            serverId={props.serverId}
            title={t('homeGovernance.signInProviders.title')}
            description={t('homeGovernance.signInProviders.description')}
        >
            {(context) => context.projection.capabilities.manageAuthentication ? (
                <SignInProvidersContent context={context} />
            ) : (
                <SettingSection
                    section={HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs.homeConnections}
                    answersFor={Object.values(HOME_SIGN_IN_PROVIDERS_SETTINGS.sectionRefs)}
                >
                    <ItemGroup>
                        <Item
                            testID="home-sign-in-providers-owners-only"
                            title={t('homeGovernance.signInProviders.ownersOnlyTitle')}
                            subtitle={t('homeGovernance.signInProviders.ownersOnlyBody')}
                            showChevron={false}
                        />
                    </ItemGroup>
                </SettingSection>
            )}
        </HomeAdministrationSection>
    );
});
