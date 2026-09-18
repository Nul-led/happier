import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import { resolveLockedSessionTitle } from './sessionUtils';

describe('resolveLockedSessionTitle', () => {
    it('keeps a safe cached title while encrypted access is still pending', () => {
        // Encryption pending is not a reason to forget a name this device already holds.
        expect(resolveLockedSessionTitle('Refactor the payments importer'))
            .toBe('Refactor the payments importer');
    });

    it('names an encrypted Session instead of reporting it as unknown', () => {
        // The generic unknown label reads as a defect; this row is simply locked.
        expect(resolveLockedSessionTitle(t('status.unknown'))).toBe(t('session.access.lockedTitleFallback'));
        expect(resolveLockedSessionTitle('   ')).toBe(t('session.access.lockedTitleFallback'));
        expect(resolveLockedSessionTitle('')).toBe(t('session.access.lockedTitleFallback'));
    });
});
