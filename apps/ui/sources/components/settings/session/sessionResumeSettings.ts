import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of Sessions › Resume (a sub-page linked from Sessions). */
export const SESSION_RESUME_SETTINGS = defineSettingsPage({
    pageId: 'session',
    subpage: { id: 'resume', route: SETTINGS_ROUTES.sessionResume, titleKey: 'settingsSession.resume.title' },
    sections: {
        replay: {
            titleKey: 'settingsSession.replayResume.title',
            settings: {
                replayEnabled: { storage: { scope: 'account', key: 'sessionReplayEnabled', access: 'read_write' }, titleKey: 'settingsSession.replayResume.enabledTitle' },
                replayStrategy: { storage: { scope: 'account', key: 'sessionReplayStrategy', access: 'read_write' },
                    titleKey: 'settingsSession.replayResume.strategyTitle',
                    keywordKeys: ['settingsSessionPages.resume.strategyRecent', 'settingsSessionPages.resume.strategySummary'],
                },
                maxSeedChars: { storage: { scope: 'account', key: 'sessionReplayMaxSeedChars', access: 'read_write' }, titleKey: 'settingsSessionPages.resume.maxSeedCharsTitle' },
                summaryModel: { titleKey: 'settingsSessionPages.resume.summaryModelSection' },
            },
        },
        handoff: {
            titleKey: 'settingsSessionPages.resume.handoffSection',
            settings: {
                handoff: { titleKey: 'settingsSession.handoff.title', descriptionKey: 'settingsSessionPages.resume.handoffLinkDescription' },
            },
        },
    },
});
