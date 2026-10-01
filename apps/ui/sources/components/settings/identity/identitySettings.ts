import { defineSettingsPage, type SettingsRouteContext, type SettingsSectionDeclaration } from '@/components/settings/catalog/settingDeclarations';
import {
    homeAdministrationGitHubAppCreatePath,
    homeAdministrationGitHubAppEditPath,
    homeAdministrationGitHubAppPath,
    homeAdministrationIdentityProviderCreatePath,
    homeAdministrationIdentityProviderEditPath,
    homeAdministrationIdentityProviderPath,
} from '@/components/settings/home/governance/homeAdministrationRoutes';
import { teamGitHubAppEditPath, teamGitHubAppPath, teamIdentityConnectionProviderEditPath, teamIdentityProviderSetupPath } from '@/components/settings/teams/teamsRoutes';

import { identitySettingAtRoute, identitySettingHomeId, identitySettingParam, identitySettingTeamAddress } from './identitySettingsRoutes';

function homeOidcEditor(context: SettingsRouteContext): string | null {
    const serverId = identitySettingHomeId(context);
    if (!serverId) return null;
    const create = identitySettingAtRoute(context, homeAdministrationIdentityProviderCreatePath(serverId));
    if (create) return create;
    const providerId = identitySettingParam(context, 'providerId');
    return providerId ? identitySettingAtRoute(context, homeAdministrationIdentityProviderEditPath(serverId, providerId)) : null;
}

function teamOidcEditor(context: SettingsRouteContext): string | null {
    const address = identitySettingTeamAddress(context);
    if (!address) return null;
    const kind = identitySettingParam(context, 'kind');
    if (context.params.kind === undefined || kind === 'oidc') {
        const create = identitySettingAtRoute(context, teamIdentityProviderSetupPath(address, 'oidc'));
        if (create) return create;
    }
    const connectionId = identitySettingParam(context, 'connectionId');
    const providerId = identitySettingParam(context, 'providerId');
    return connectionId && providerId
        ? identitySettingAtRoute(context, teamIdentityConnectionProviderEditPath(address, connectionId, providerId))
        : null;
}

const oidcSections = {
    configuration: {
        titleKey: 'identityAdministration.configuration',
        settings: {
            displayName: { titleKey: 'identityAdministration.displayName' },
            issuer: { titleKey: 'identityAdministration.issuer' },
            clientId: { titleKey: 'identityAdministration.clientId' },
            clientSecret: { titleKey: 'identityAdministration.clientSecret', sensitive: true },
            callbackUrl: { titleKey: 'identityAdministration.callbackUrl' },
        },
    },
    advanced: {
        titleKey: 'identityAdministration.advanced',
        settings: {
            scopes: { titleKey: 'identityAdministration.scopes' },
            loginClaim: { titleKey: 'identityAdministration.loginClaim' },
            emailClaim: { titleKey: 'identityAdministration.emailClaim' },
            groupsClaim: { titleKey: 'identityAdministration.groupsClaim' },
            fetchUserInfo: { titleKey: 'identityAdministration.fetchUserInfo' },
            clientAuthenticationMethod: { titleKey: 'identityAdministration.clientAuthenticationMethod' },
            usersAllowlist: { titleKey: 'identityAdministration.diagnosticsRuleUsers' },
            emailDomains: { titleKey: 'identityAdministration.diagnosticsRuleEmailDomains' },
            groupsAny: { titleKey: 'identityAdministration.groupsAny' },
            groupsAll: { titleKey: 'identityAdministration.groupsAll' },
            storeRefreshToken: { titleKey: 'identityAdministration.storeRefreshToken' },
            buttonColor: { titleKey: 'identityAdministration.buttonColor' },
            iconHint: { titleKey: 'identityAdministration.iconHint' },
        },
    },
    actions: {
        titleKey: 'identityAdministration.actions',
        settings: {
            validate: { titleKey: 'identityAdministration.test' },
            save: { titleKey: 'identityAdministration.save' },
        },
    },
} as const satisfies Record<string, SettingsSectionDeclaration>;

export const HOME_MANAGED_OIDC_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: { id: 'oidc', route: homeOidcEditor, titleKey: 'identityAdministration.configuration' },
    sections: oidcSections,
});
export const TEAM_MANAGED_OIDC_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: { id: 'oidc', route: teamOidcEditor, titleKey: 'identityAdministration.configuration' },
    sections: oidcSections,
});

export const HOME_IDENTITY_PROVIDER_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: {
        id: 'identityProvider',
        titleKey: 'identityAdministration.configuration',
        route: (context: SettingsRouteContext) => {
            const serverId = identitySettingHomeId(context);
            const providerId = identitySettingParam(context, 'providerId');
            return serverId && providerId
                ? identitySettingAtRoute(context, homeAdministrationIdentityProviderPath(serverId, providerId))
                : null;
        },
    },
    sections: {
        configuration: { titleKey: 'identityAdministration.configuration', settings: {
            callbackUrl: { titleKey: 'identityAdministration.callbackUrl' },
            issuer: { titleKey: 'identityAdministration.issuer' },
            clientId: { titleKey: 'identityAdministration.clientId' },
            clientSecret: { titleKey: 'identityAdministration.clientSecret', sensitive: true },
            secretRepair: { titleKey: 'identityAdministration.secretRepair' },
        } },
        consumers: { titleKey: 'identityAdministration.teamConsumers', settings: {
            teamConsumers: { titleKey: 'identityAdministration.teamConsumers' },
        } },
        actions: { titleKey: 'identityAdministration.actions', settings: {
            test: { titleKey: 'identityAdministration.test' },
            edit: { titleKey: 'identityAdministration.edit' },
            enable: { titleKey: 'identityAdministration.enable' },
            disable: { titleKey: 'identityAdministration.disable' },
            remove: { titleKey: 'identityAdministration.remove' },
        } },
    },
});

function homeGitHubApp(context: SettingsRouteContext, editor: boolean): string | null {
    const serverId = identitySettingHomeId(context);
    if (!serverId) return null;
    if (editor) {
        const create = identitySettingAtRoute(context, homeAdministrationGitHubAppCreatePath(serverId));
        if (create) return create;
    }
    const registrationId = identitySettingParam(context, 'registrationId');
    return registrationId ? identitySettingAtRoute(context, editor
        ? homeAdministrationGitHubAppEditPath(serverId, registrationId)
        : homeAdministrationGitHubAppPath(serverId, registrationId)) : null;
}

function teamGitHubApp(context: SettingsRouteContext, editor: boolean): string | null {
    const address = identitySettingTeamAddress(context);
    if (!address) return null;
    if (editor && identitySettingParam(context, 'kind') === 'github_app_identity') {
        const create = identitySettingAtRoute(context, teamIdentityProviderSetupPath(address, 'github_app_identity'));
        if (create) return create;
    }
    const registrationId = identitySettingParam(context, 'registrationId');
    return registrationId ? identitySettingAtRoute(context, editor
        ? teamGitHubAppEditPath(address, registrationId)
        : teamGitHubAppPath(address, registrationId)) : null;
}

const githubAppSections = {
    configuration: { titleKey: 'identityAdministration.configuration', settings: {
        githubHost: { titleKey: 'identityAdministration.githubHost' },
        callbackUrl: { titleKey: 'identityAdministration.callbackUrl' },
        githubAppSlug: { titleKey: 'identityAdministration.githubAppSlug' },
        githubOwnerLogin: { titleKey: 'identityAdministration.githubOwnerLogin' },
        githubPrivateKey: { titleKey: 'identityAdministration.githubPrivateKey', sensitive: true },
        clientSecret: { titleKey: 'identityAdministration.clientSecret', sensitive: true },
    } },
    installations: { titleKey: 'identityAdministration.githubInstallations', settings: {
        githubInstallations: { titleKey: 'identityAdministration.githubInstallations' },
        teamConsumers: { titleKey: 'identityAdministration.teamConsumers' },
        remove: { titleKey: 'identityAdministration.remove', keywordKeys: ['identityAdministration.githubInstallations'] },
    } },
    verification: { titleKey: 'identityAdministration.githubVerifyInstallation', settings: {
        githubInstallationId: { titleKey: 'identityAdministration.githubInstallationId' },
        githubOrganizationId: { titleKey: 'identityAdministration.githubOrganizationId' },
        verify: { titleKey: 'identityAdministration.githubVerifyInstallation' },
    } },
    access: { settings: {
        currentAccess: { titleKey: 'identityAdministration.githubCurrentAccess' },
        setupAccess: { titleKey: 'identityAdministration.githubSetupAccess' },
    } },
    actions: { titleKey: 'identityAdministration.actions', settings: {
        edit: { titleKey: 'identityAdministration.githubAppEditTitle' },
        signIn: { titleKey: 'identityAdministration.githubFacetSignIn' },
        directory: { titleKey: 'identityAdministration.githubFacetDirectory' },
    } },
} as const satisfies Record<string, SettingsSectionDeclaration>;

export const HOME_GITHUB_APP_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: { id: 'githubApp', route: (context) => homeGitHubApp(context, false), titleKey: 'identityAdministration.githubAppEditTitle' },
    sections: githubAppSections,
});
export const TEAM_GITHUB_APP_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: { id: 'githubApp', route: (context) => teamGitHubApp(context, false), titleKey: 'identityAdministration.githubAppEditTitle' },
    sections: githubAppSections,
});

const githubEditorSections = {
    configuration: { titleKey: 'identityAdministration.configuration', settings: {
        githubHost: { titleKey: 'identityAdministration.githubHost' },
        githubAppId: { titleKey: 'identityAdministration.githubAppId' },
        githubClientId: { titleKey: 'identityAdministration.githubClientId' },
        githubAppSlug: { titleKey: 'identityAdministration.githubAppSlug' },
        githubOwnerLogin: { titleKey: 'identityAdministration.githubOwnerLogin' },
        clientSecret: { titleKey: 'identityAdministration.clientSecret', sensitive: true },
        privateKey: { titleKey: 'identityAdministration.githubPrivateKey', sensitive: true },
        webhookSecret: { titleKey: 'identityAdministration.githubWebhookSecret', sensitive: true },
        callbackUrl: { titleKey: 'identityAdministration.callbackUrl' },
    } },
    setup: { settings: {
        manifestAppName: { titleKey: 'identityAdministration.githubAppName' },
        manifestForOrganization: { titleKey: 'identityAdministration.githubOrganizationOwner' },
        manifestOrganization: { titleKey: 'identityAdministration.githubOrganizationLogin' },
        manifestSetup: { titleKey: 'identityAdministration.githubManifestSetup' },
        manualSetup: { titleKey: 'identityAdministration.githubManualSetup' },
    } },
    actions: { titleKey: 'identityAdministration.actions', settings: {
        save: { titleKey: 'identityAdministration.save' },
    } },
} as const satisfies Record<string, SettingsSectionDeclaration>;

export const HOME_GITHUB_APP_EDITOR_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: { id: 'githubAppEditor', route: (context) => homeGitHubApp(context, true), titleKey: 'identityAdministration.githubAppEditTitle' },
    sections: githubEditorSections,
});
export const TEAM_GITHUB_APP_EDITOR_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: { id: 'githubAppEditor', route: (context) => teamGitHubApp(context, true), titleKey: 'identityAdministration.githubAppEditTitle' },
    sections: githubEditorSections,
});
