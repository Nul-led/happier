import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

const PRESENTATION_KEYWORDS = [
    'settingsSession.sessionCreation.wizardPresentationAutoTitle',
    'settingsSession.sessionCreation.wizardPresentationListTitle',
    'settingsSession.sessionCreation.wizardPresentationDropdownTitle',
] as const;

/** The searchable settings of Sessions › Wizard layout (a sub-page linked from Sessions). */
export const NEW_SESSION_WIZARD_SETTINGS = defineSettingsPage({
    pageId: 'session',
    subpage: { id: 'wizard', route: SETTINGS_ROUTES.newSessionWizard, titleKey: 'settingsSession.sessionCreation.wizardDispositionTitle' },
    sections: {
        wideScreens: {
            titleKey: 'settingsSessionPages.wizard.wideScreensSection',
            settings: {
                columns: { titleKey: 'settingsSession.sessionCreation.wizardColumnsTitle' },
            },
        },
        steps: {
            titleKey: 'settingsSessionPages.wizard.stepsSection',
            settings: {
                profiles: { titleKey: 'settingsSessionPages.wizard.steps.profiles', keywordKeys: PRESENTATION_KEYWORDS },
                backends: { titleKey: 'settingsSessionPages.wizard.steps.backends', keywordKeys: PRESENTATION_KEYWORDS },
                models: { titleKey: 'settingsSessionPages.wizard.steps.models', keywordKeys: PRESENTATION_KEYWORDS },
                machines: { titleKey: 'settingsSessionPages.wizard.steps.machines', keywordKeys: PRESENTATION_KEYWORDS },
                paths: { titleKey: 'settingsSessionPages.wizard.steps.paths', keywordKeys: PRESENTATION_KEYWORDS },
                permissions: { titleKey: 'settingsSessionPages.wizard.steps.permissions', keywordKeys: PRESENTATION_KEYWORDS },
            },
        },
    },
});
