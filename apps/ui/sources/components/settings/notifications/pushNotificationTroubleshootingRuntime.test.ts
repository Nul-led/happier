import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

import { resolveTokenSubtitle } from './pushNotificationTroubleshootingRuntime';

describe('pushNotificationTroubleshootingRuntime', () => {
    it('includes the native token error in the unavailable-token subtitle', () => {
        expect(resolveTokenSubtitle({
            ok: false,
            reason: 'token_unavailable',
            message: 'Firebase Installations API returned 403',
        }, null)).toBe(
            'settingsNotifications.pushTroubleshooting.token.deviceUnavailableSubtitle\n'
            + 'Firebase Installations API returned 403',
        );
    });
});
