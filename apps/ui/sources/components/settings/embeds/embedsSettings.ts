import { defineSettingsPage, type SettingsRouteContext } from '@/components/settings/catalog/settingDeclarations';

import { EMBEDS_COLLECTION_ROOT, EMBEDS_NEW_PATH, embedDetailPath, resolveSelectedEmbedTokenId } from './embedsCollection';

/**
 * Where an embed's settings live: the embed being viewed (or the one being created). Search offers
 * these rows only while one is open, because each embed has its own; with none open they are omitted.
 */
function resolveEmbedSettingsRoute(context: SettingsRouteContext): string | null {
    const pathname = context.pathname.replace(/\/+$/, '');
    if (pathname === EMBEDS_NEW_PATH) return EMBEDS_NEW_PATH;
    if (!pathname.startsWith(`${EMBEDS_COLLECTION_ROOT}/`)) return null;
    const tokenId = resolveSelectedEmbedTokenId(pathname);
    return tokenId ? embedDetailPath(tokenId) : null;
}

/** Settings → Embeds detail's searchable settings. Rows render their labels from these declarations. */
export const EMBED_SETTINGS = defineSettingsPage({
    pageId: 'embeds',
    subpage: { id: 'embed', route: resolveEmbedSettingsRoute, titleKey: 'settingsEmbeds.title' },
    sections: {
        sites: {
            titleKey: 'settingsEmbeds.sites.title',
            settings: {
                sites: { titleKey: 'settingsEmbeds.sites.title', descriptionKey: 'settingsEmbeds.sites.description' },
            },
        },
        capabilities: {
            titleKey: 'settingsEmbeds.capabilities.title',
            settings: {
                send: { titleKey: 'settingsEmbeds.capabilities.send', descriptionKey: 'settingsEmbeds.capabilities.sendDescription' },
                approve: { titleKey: 'settingsApiTokens.grant.approve.title', descriptionKey: 'settingsEmbeds.capabilities.approveOn' },
                changeModel: { titleKey: 'settingsEmbeds.capabilities.changeModel' },
                permissionModes: { titleKey: 'settingsEmbeds.capabilities.permissionModes', descriptionKey: 'settingsEmbeds.capabilities.permissionModesDescription' },
            },
        },
        models: {
            titleKey: 'settingsEmbeds.models.title',
            settings: {
                // The section's description already says what the restriction does; the row repeats nothing.
                allowedModels: { titleKey: 'settingsEmbeds.models.allowed', keywordKeys: ['settingsEmbeds.models.description'] },
            },
        },
        organization: {
            titleKey: 'settingsEmbeds.organization.title',
            settings: {
                folder: { titleKey: 'settingsEmbeds.organization.folder' },
                tags: { titleKey: 'settingsEmbeds.organization.tags' },
            },
        },
        composer: {
            titleKey: 'settingsEmbeds.composer.title',
            settings: {
                attachments: { titleKey: 'settingsEmbeds.composer.attachments', descriptionKey: 'settingsEmbeds.composer.attachmentsDescription' },
            },
        },
        sessions: {
            titleKey: 'settingsEmbeds.sessions.title',
            settings: {
                createSessions: { titleKey: 'settingsEmbeds.sessions.allow', keywordKeys: ['settingsEmbeds.sessions.computer', 'settingsEmbeds.sessions.agent'] },
                newChat: { titleKey: 'settingsEmbeds.sessions.newChat', descriptionKey: 'settingsEmbeds.sessions.newChatDescription' },
            },
        },
        appearance: {
            titleKey: 'settingsEmbeds.appearance.title',
            settings: {
                mode: { titleKey: 'settingsEmbeds.appearance.mode' },
                theme: { titleKey: 'settingsEmbeds.appearance.theme' },
                colors: { titleKey: 'settingsEmbeds.appearance.colors' },
                fontFamily: { titleKey: 'settingsEmbeds.appearance.fontFamily' },
                fontFile: { titleKey: 'settingsEmbeds.appearance.fontFile', descriptionKey: 'settingsEmbeds.appearance.fontFileDescription' },
                textSize: { titleKey: 'settingsEmbeds.appearance.textSize' },
                corners: { titleKey: 'settingsEmbeds.appearance.corners' },
                density: { titleKey: 'settingsEmbeds.appearance.density' },
            },
        },
    },
});
