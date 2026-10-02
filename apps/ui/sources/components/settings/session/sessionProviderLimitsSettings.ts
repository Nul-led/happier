import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of Sessions › Provider limits (a sub-page linked from Sessions). */
export const SESSION_PROVIDER_LIMITS_SETTINGS = defineSettingsPage({
    pageId: 'session',
    subpage: { id: 'providerLimits', route: SETTINGS_ROUTES.sessionProviderLimits, titleKey: 'settingsSession.providerLimits.title' },
    sections: {
        usageLimitRecovery: {
            titleKey: 'settingsSession.usageLimitRecovery.title',
            featureId: 'sessions.usageLimitRecovery',
            settings: {
                autoWait: { titleKey: 'settingsSession.usageLimitRecovery.autoWaitTitle' },
                resumePrompt: {
                    titleKey: 'settingsSession.usageLimitRecovery.resumePromptTitle',
                    keywordKeys: ['settingsSession.usageLimitRecovery.customResumePromptTitle'],
                },
            },
        },
        usageGauge: {
            titleKey: 'settingsSession.providerUsageGauge.title',
            featureId: 'connectedServices.quotas',
            settings: {
                gaugeVisible: { storage: { scope: 'account', key: 'sessionProviderUsageGaugeMode', access: 'read_write' }, titleKey: 'settingsSession.providerUsageGauge.visibilityTitle' },
                gaugeLabels: { storage: { scope: 'account', key: 'sessionUsageGaugeLabels', access: 'read_write' }, titleKey: 'settingsSession.providerUsageGauge.labelsTitle' },
                gaugeWindow: { storage: { scope: 'account', key: 'sessionProviderUsageGaugeWindowMode', access: 'read_write' },
                    titleKey: 'settingsSession.providerUsageGauge.windowTitle',
                    keywordKeys: [
                        'settingsSession.providerUsageGauge.windowDailyTitle',
                        'settingsSession.providerUsageGauge.windowWeeklyTitle',
                    ],
                },
            },
        },
    },
});
