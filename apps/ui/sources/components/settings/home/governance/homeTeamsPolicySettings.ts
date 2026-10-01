import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { identitySettingHomeId } from '@/components/settings/identity/identitySettingsRoutes';

import { homeAdministrationPoliciesPath } from './homeAdministrationRoutes';

/** Who creates Teams on a Home, and whether members outside every Team see them. */
export const HOME_TEAMS_POLICY_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: {
        id: 'teamsPolicy',
        titleKey: 'homeGovernance.policies',
        route: (context) => {
            const serverId = identitySettingHomeId(context);
            return serverId ? homeAdministrationPoliciesPath(serverId) : null;
        },
    },
    sections: {
        teamCreation: { titleKey: 'homeGovernance.teamCreation', settings: {
            teamCreationPolicy: { titleKey: 'homeGovernance.teamCreation', keywordKeys: ['homeGovernance.teamCreationSelfService'] },
        } },
        teamsVisibility: { titleKey: 'homeGovernance.teamsVisibility', settings: {
            teamsVisibleToMembers: {
                titleKey: 'homeGovernance.teamsVisibleToMembers',
                descriptionKey: 'homeGovernance.teamsVisibleToMembersDescription',
            },
        } },
    },
});
