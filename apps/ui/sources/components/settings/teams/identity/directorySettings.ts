import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { identitySettingAtRoute, identitySettingParam, identitySettingTeamAddress } from '@/components/settings/identity/identitySettingsRoutes';

import { teamDirectoryPath, teamDirectorySourcePath } from '../teamsRoutes';

export const DIRECTORY_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: {
        id: 'directory',
        titleKey: 'teams.authentication.directory.title',
        route: (context) => {
            const address = identitySettingTeamAddress(context);
            return address ? teamDirectoryPath(address) : null;
        },
    },
    sections: {
        actions: { settings: {
            addSource: { titleKey: 'teams.authentication.directory.setup.add' },
            workosSetup: { titleKey: 'teams.authentication.directory.setup.workos', descriptionKey: 'teams.authentication.directory.setup.workosSubtitle' },
        } },
    },
});

export const DIRECTORY_SOURCE_SETTINGS = defineSettingsPage({
    pageId: 'teams',
    subpage: {
        id: 'directorySource',
        titleKey: 'teams.authentication.directory.title',
        route: (context) => {
            const address = identitySettingTeamAddress(context);
            const sourceId = identitySettingParam(context, 'sourceId');
            return address && sourceId ? identitySettingAtRoute(context, teamDirectorySourcePath(address, sourceId)) : null;
        },
    },
    sections: {
        actions: { titleKey: 'teams.authentication.directory.actions.section', settings: {
            syncNow: { titleKey: 'teams.authentication.directory.actions.sync', keywordKeys: ['common.retry'] },
            pause: { titleKey: 'teams.authentication.directory.actions.pause' },
            resume: { titleKey: 'teams.authentication.directory.actions.resume' },
            remove: { titleKey: 'teams.authentication.directory.actions.remove' },
            workosSetup: { titleKey: 'identityAdministration.workosCheckSetup' },
        } },
        groups: { titleKey: 'identityAdministration.directoryGroups', settings: {
            searchGroups: { titleKey: 'identityAdministration.searchGroups' },
        } },
    },
});
