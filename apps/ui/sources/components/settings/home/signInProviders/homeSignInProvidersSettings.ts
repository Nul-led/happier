import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { identitySettingHomeId } from '@/components/settings/identity/identitySettingsRoutes';

import { homeAdministrationSignInProvidersPath } from '../governance/homeAdministrationRoutes';

/**
 * The Sign-in providers page: the Home's identity providers and GitHub Apps, where managed sign-in
 * may reach, and what Teams may add. Generic fields only, never provider names, hosts or keys.
 */
export const HOME_SIGN_IN_PROVIDERS_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: {
        id: 'signInProviders',
        titleKey: 'homeGovernance.signInProviders.title',
        route: (context) => {
            const serverId = identitySettingHomeId(context);
            return serverId ? homeAdministrationSignInProvidersPath(serverId) : null;
        },
    },
    sections: {
        homeConnections: { titleKey: 'identityAdministration.homeConnections', settings: {
            homeConnections: { titleKey: 'identityAdministration.homeConnections' },
            addProvider: { titleKey: 'identityAdministration.add', keywordKeys: ['identityAdministration.homeConnections'] },
            workos: { titleKey: 'identityAdministration.workos' },
        } },
        githubApps: { titleKey: 'identityAdministration.githubApps', settings: {
            githubApps: { titleKey: 'identityAdministration.githubApps' },
            addGitHubApp: { titleKey: 'identityAdministration.githubAppAdd' },
        } },
        identityNetwork: { titleKey: 'homeGovernance.privateEndpoints', settings: {
            publicOnly: { titleKey: 'homeGovernance.privateEndpointsPublicOnly' },
            privateAllowlist: { titleKey: 'homeGovernance.privateEndpointsAllowlist' },
            hostnames: { titleKey: 'homeGovernance.privateEndpointsHostnames' },
            cidrs: { titleKey: 'homeGovernance.privateEndpointsCidrs' },
            ports: { titleKey: 'homeGovernance.privateEndpointsPorts' },
            saveNetwork: { titleKey: 'homeGovernance.privateEndpointsSave' },
        } },
        teamProviders: { titleKey: 'homeGovernance.signInProviders.teamRules', settings: {
            allowedTeamProviderKinds: { titleKey: 'homeGovernance.manageTeams', keywordKeys: ['identityAdministration.eligibleProviders', 'identityAdministration.providerOidc', 'identityAdministration.providerWorkosSso', 'identityAdministration.providerGitHub'] },
            teamJitAllowed: { titleKey: 'homeGovernance.teamJit', descriptionKey: 'homeGovernance.teamJitDescription' },
            approvedGitHubEnterpriseOrigins: { titleKey: 'homeGovernance.githubEnterpriseOrigins', descriptionKey: 'homeGovernance.githubEnterpriseOriginsDescription' },
            saveOrigins: { titleKey: 'common.save' },
        } },
    },
});
