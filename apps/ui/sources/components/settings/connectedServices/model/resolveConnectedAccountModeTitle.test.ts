import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('resolveConnectedAccountModeTitle', () => {
    it('keeps a plugin title and names an untitled mode by what it asks, never by its id', async () => {
        const { resolveConnectedAccountModeTitle } = await import('./resolveConnectedAccountModeTitle');

        expect(resolveConnectedAccountModeTitle({ kind: 'manual', title: 'API key' })).toBe('API key');
        expect(resolveConnectedAccountModeTitle({ kind: 'manual', title: '' })).toBe('connectedServicesSettings.modeManual');
        expect(resolveConnectedAccountModeTitle({ kind: 'oauthDeviceCode', title: '' })).toBe('connectedServicesSettings.modeDeviceCode');
        expect(resolveConnectedAccountModeTitle({ kind: 'oauthAuthorizationCode', title: '' })).toBe('connectedServicesSettings.modeBrowser');
    });
});
