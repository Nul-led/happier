import type { TranslationKey } from '@/text';

/** One choice owner for the Desktop control and its declared Action binding. */
export const AUTO_HIDE_DELAY_OPTIONS: readonly Readonly<{ value: 3000 | 6000 | 10000 | 30000; titleKey: TranslationKey }>[] = [
    { value: 3000, titleKey: 'settingsDesktop.overlay.autoHideDelay3sTitle' },
    { value: 6000, titleKey: 'settingsDesktop.overlay.autoHideDelay6sTitle' },
    { value: 10000, titleKey: 'settingsDesktop.overlay.autoHideDelay10sTitle' },
    { value: 30000, titleKey: 'settingsDesktop.overlay.autoHideDelay30sTitle' },
];
