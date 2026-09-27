import { defineSettingsPage, settingsHosts, type SettingsHostPredicate } from '@/components/settings/catalog/settingDeclarations';
import { resolveSetupSurfacePolicy } from '@/sync/domains/server/setup/setupSurfacePolicy';

// The setup surface policy is fixed by the build, so like a host fact it decides whether a row exists.
const localRelayHostAllowed: SettingsHostPredicate = (host) => settingsHosts.tauriDesktop(host)
    && resolveSetupSurfacePolicy().relay.allowLocalRelayHost;
const relaySelectionAllowed: SettingsHostPredicate = () => resolveSetupSurfacePolicy().relay.allowRelaySelection;
const addHomeAllowed: SettingsHostPredicate = () => {
    const { relay } = resolveSetupSurfacePolicy();
    return relay.allowRelaySelection && relay.allowCustomRelayUrl;
};

/** The searchable settings of the `servers` page (Homes). Rows render their labels from these declarations. */
export const SERVERS_SETTINGS = defineSettingsPage({
    pageId: 'servers',
    sections: {
        connection: {
            titleKey: 'server.page.connectionTitle',
            settings: {
                standardOnly: { titleKey: 'personalHome.settings.standardOnlyTitle', descriptionKey: 'personalHome.settings.standardOnlySubtitle' },
            },
        },
        homesView: {
            // Rendered while a Homes group is being edited (page state).
            titleKey: 'server.multiServerView.title',
            settings: {
                groupPresentation: {
                    titleKey: 'server.multiServerView.presentationChoice.title',
                    keywordKeys: ['server.multiServerView.presentationChoice.flat', 'server.multiServerView.presentationChoice.grouped'],
                },
            },
        },
        relayAccess: {
            // The desktop app hosts the local relay (when the build allows it); its access controls
            // render nowhere else. The LAN and tunnel fields wait on the chosen method (page state).
            titleKey: 'settings.relayAccess.title',
            host: localRelayHostAllowed,
            settings: {
                accessMethod: { titleKey: 'settings.relayAccess.methodTitle', descriptionKey: 'settings.relayAccess.footer' },
                lanUrl: { titleKey: 'settings.relayAccess.fields.urlLabel' },
                cloudflareHostname: { titleKey: 'settings.relayAccess.fields.hostnameLabel' },
                cloudflareToken: { titleKey: 'settings.relayAccess.fields.tokenLabel' },
            },
        },
        add: {
            // The page header's "Add a Home" opens this form through the setting's anchor.
            titleKey: 'server.pageSections.addTitle',
            host: addHomeAllowed,
            settings: {
                addHome: { titleKey: 'server.addServerTitle', keywordKeys: ['server.pageSections.addTitle'] },
            },
        },
        actions: {
            titleKey: 'common.actions',
            host: relaySelectionAllowed,
            settings: {
                createPersonalHome: { titleKey: 'setupOnboarding.setupNewRelayAction', descriptionKey: 'setupOnboarding.openSetupWizardSubtitle' },
            },
        },
    },
});
