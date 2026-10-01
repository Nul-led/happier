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

/**
 * The searchable settings of the `servers` page (Settings → Homes, landing on This device). Rows render
 * their labels from these declarations.
 */
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
    },
});

/**
 * The searchable settings of the `serversAdd` page (Settings → Homes → Add a Home, the collection's
 * draft): adding a Home by any path, and setting one up on a server (desktop app).
 */
export const HOMES_ADD_SETTINGS = defineSettingsPage({
    pageId: 'serversAdd',
    sections: {
        add: {
            titleKey: 'addFlows.addHome',
            settings: {
                addHome: { titleKey: 'addFlows.addHome', keywordKeys: ['server.pageSections.addTitle', 'server.addServerTitle'], host: addHomeAllowed },
                createPersonalHome: {
                    titleKey: 'setupOnboarding.setupNewRelayAction',
                    descriptionKey: 'setupOnboarding.openSetupWizardSubtitle',
                    host: relaySelectionAllowed,
                },
            },
        },
    },
});
