import { describe, expect, it } from 'vitest';

import { homeDeviceApprovalTranslations } from './homeDeviceApprovalTranslations';

describe('homeDeviceApprovalTranslations', () => {
    it('owns complete, localized device-approval copy for every supported locale', () => {
        const english = homeDeviceApprovalTranslations.en;
        const locales = Object.entries(homeDeviceApprovalTranslations);
        expect(locales).toHaveLength(12);

        for (const [locale, translation] of locales) {
            expect(Object.keys(translation).sort()).toEqual(Object.keys(english).sort());
            if (locale === 'en') continue;
            expect(translation.title).not.toBe(english.title);
            expect(translation.deviceFallback).not.toBe(english.deviceFallback);
            expect(translation.requestDetailsHelp).not.toBe(english.requestDetailsHelp);
            expect(translation.decisionRecovery).not.toBe(english.decisionRecovery);
        }
    });
});
