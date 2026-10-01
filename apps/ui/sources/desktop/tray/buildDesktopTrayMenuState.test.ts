import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import { buildDesktopTrayMenuState } from './buildDesktopTrayMenuState';

const row = (relayUrl: string) => ({
    relayUrl,
    state: 'connected' as const,
    appManaged: true,
    serviceTargetMode: 'pinned' as const,
    actions: ['restart', 'stop'] as const,
});

describe('buildDesktopTrayMenuState', () => {
    it('sends every native label localized, leaving the Stop confirmations\' {relay} for the native side to fill', () => {
        const state = buildDesktopTrayMenuState({
            services: { status: 'pending' },
            serviceAutostart: null,
            taskParams: {},
            homeNameFor: () => null,
            t,
        });
        for (const [key, value] of Object.entries(state.labels)) {
            expect(value.trim(), key).not.toBe('');
            expect(value, key).not.toMatch(/^settingsDesktop\.|^machine\./);
        }
        expect(state.labels.stopConfirmTitle).toContain('{relay}');
        expect(state.labels.stopConfirmBody).toContain('{relay}');
    });

    it('names each row by its Home when the app knows the name, and leaves the host to the native menu otherwise', () => {
        const state = buildDesktopTrayMenuState({
            services: { status: 'listed', complete: true, rows: [row('https://home.example.test'), row('https://work.example.test')] },
            serviceAutostart: 'at-login',
            taskParams: { channel: 'stable' },
            homeNameFor: (relayUrl) => (relayUrl === 'https://home.example.test' ? 'Personal Home' : null),
            t,
        });
        expect(state.services).toEqual({
            status: 'listed',
            complete: true,
            rows: [{ ...row('https://home.example.test'), name: 'Personal Home' }, row('https://work.example.test')],
        });
        expect(state).toMatchObject({ serviceAutostart: 'at-login', taskParams: { channel: 'stable' } });
    });
});
