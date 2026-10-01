import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { identitySettingAtRoute, identitySettingParam, identitySettingTeamAddress } from '@/components/settings/identity/identitySettingsRoutes';

import { teamAuthenticationPath, teamIdentityConnectionPath } from '../teamsRoutes';

export const TEAM_AUTHENTICATION_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: {
        id: 'authentication',
        titleKey: 'teams.tabs.authentication',
        route: (context) => {
            const address = identitySettingTeamAddress(context);
            return address ? teamAuthenticationPath(address) : null;
        },
    },
    sections: {
        admission: { titleKey: 'teams.authentication.policy.admissionSection', settings: {
            admissionInviteOnly: { titleKey: 'teams.authentication.policy.admissionInviteOnly' },
            admissionProvisioned: { titleKey: 'teams.authentication.policy.admissionProvisioned' },
            admissionJit: { titleKey: 'teams.authentication.policy.admissionJit' },
        } },
        accepted: { titleKey: 'teams.authentication.policy.acceptedSection', settings: {
            acceptedInherit: { titleKey: 'teams.authentication.policy.acceptedInherit' },
            acceptedRestricted: { titleKey: 'teams.authentication.policy.acceptedRestricted' },
            acceptedMethods: { titleKey: 'teams.authentication.policy.connectionsSection' },
            save: { titleKey: 'common.save' },
        } },
        connections: { settings: {
            connections: { titleKey: 'teams.authentication.connectionsSection' },
            eligibleProviders: { titleKey: 'identityAdministration.eligibleProviders' },
            githubApps: { titleKey: 'identityAdministration.githubApps' },
            addGitHubApp: { titleKey: 'identityAdministration.githubAppAdd' },
        } },
        directory: { settings: {
            directory: { titleKey: 'teams.authentication.directory.title', descriptionKey: 'teams.authentication.directory.manageSubtitle' },
        } },
    },
});

export const TEAM_IDENTITY_CONNECTION_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: {
        id: 'identityConnection',
        titleKey: 'teams.authentication.detail.connection',
        route: (context) => {
            const address = identitySettingTeamAddress(context);
            const connectionId = identitySettingParam(context, 'connectionId');
            return address && connectionId ? identitySettingAtRoute(context, teamIdentityConnectionPath(address, connectionId)) : null;
        },
    },
    sections: {
        configuration: { titleKey: 'teams.authentication.detail.configuration', settings: {
            allowedUsers: { titleKey: 'teams.authentication.detail.allowedUsers' },
            allowedDomains: { titleKey: 'teams.authentication.detail.allowedDomains' },
            groupsAny: { titleKey: 'identityAdministration.groupsAny' },
            groupsAll: { titleKey: 'identityAdministration.groupsAll' },
            organization: { titleKey: 'teams.authentication.detail.organization' },
            save: { titleKey: 'identityAdministration.save' },
            workosConnection: { titleKey: 'identityAdministration.workosChooseConnection' },
        } },
        groupMappings: { titleKey: 'identityAdministration.directoryGroups', settings: {
            groupMappings: { titleKey: 'identityAdministration.directoryGroups', keywordKeys: ['identityAdministration.removeMapping'] },
            externalGroupId: { titleKey: 'identityAdministration.directoryGroups' },
            mapCreate: { titleKey: 'identityAdministration.mapCreate' },
            mapExisting: { titleKey: 'identityAdministration.mapExisting' },
        } },
        actions: { titleKey: 'identityAdministration.actions', settings: {
            edit: { titleKey: 'identityAdministration.edit' },
            test: { titleKey: 'identityAdministration.test' },
            enable: { titleKey: 'identityAdministration.enable' },
            disable: { titleKey: 'identityAdministration.disable' },
            workosSetupSso: { titleKey: 'identityAdministration.workosSetupSso' },
            workosSetupDirectory: { titleKey: 'identityAdministration.workosSetupDirectory' },
            workosCheckSetup: { titleKey: 'identityAdministration.workosCheckSetup' },
            remove: { titleKey: 'identityAdministration.remove' },
        } },
    },
});
