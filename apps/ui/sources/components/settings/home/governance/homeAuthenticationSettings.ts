import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { identitySettingHomeId } from '@/components/settings/identity/identitySettingsRoutes';

import { homeAdministrationPoliciesPath } from './homeAdministrationRoutes';

/**
 * How people sign in and join, on Policies. Generic fields only, never the Home's method names.
 * Providers, GitHub Apps, private endpoints and Team rules are declared by the Sign-in providers page.
 */
export const HOME_AUTHENTICATION_SETTINGS = defineSettingsPage({
    pageId: 'homeAdministration',
    subpage: {
        id: 'authenticationPolicy',
        titleKey: 'homeGovernance.signInTitle',
        route: (context) => {
            const serverId = identitySettingHomeId(context);
            return serverId ? homeAdministrationPoliciesPath(serverId) : null;
        },
    },
    sections: {
        authentication: { titleKey: 'homeGovernance.signInTitle', settings: {
            enabledMethodIds: { titleKey: 'homeGovernance.signInMethods' },
            permittedAccountModes: { titleKey: 'homeGovernance.accountModes' },
            recommendedProvisioningMode: { titleKey: 'homeGovernance.recommendedMode', descriptionKey: 'homeGovernance.recommendedModeDescription' },
            admission: { titleKey: 'homeGovernance.signInPolicy.newAccounts', keywordKeys: ['homeGovernance.signInPolicy.admissionTitle'] },
            anonymousSignup: { titleKey: 'homeGovernance.signInPolicy.anonymousSignup', descriptionKey: 'homeGovernance.signInPolicy.anonymousSignupDescription' },
            storagePolicy: { titleKey: 'homeGovernance.signInPolicy.storagePolicy', keywordKeys: ['homeGovernance.signInPolicy.encryptionTitle'] },
            signInServiceDisabled: { titleKey: 'homeGovernance.signInPolicy.signInService', descriptionKey: 'homeGovernance.signInPolicy.signInServiceDescription' },
            saveAuthentication: { titleKey: 'common.save' },
        } },
    },
});
