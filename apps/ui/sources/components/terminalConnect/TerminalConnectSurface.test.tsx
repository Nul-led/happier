import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { TerminalConnectSurface } from './TerminalConnectSurface';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

afterEach(standardCleanup);

describe('terminal pairing storage disclosure', () => {
    it('discloses server-readable storage instead of E2EE for a plain Account', async () => {
        const state = {
            kind: 'approval' as const,
            publicKey: 'test-public-key',
            isLoading: false,
            storageMode: 'plain' as const,
            homeUrl: 'https://target-home.example.test',
            onApprove: vi.fn(),
            onReject: vi.fn(),
        };
        const screen = await renderScreen(<TerminalConnectSurface state={state} />);
        const content = screen.getTextContent();
        expect(content).toContain('terminal.plaintextStorage');
        expect(content).toContain(state.homeUrl);
        expect(content).not.toContain('terminal.endToEndEncrypted');
        expect(content).not.toContain('terminal.securityFooterDevice');
    });

    it('keeps approval unavailable until the target Account mode is known', async () => {
        const state = {
            kind: 'approval' as const,
            publicKey: 'test-public-key',
            isLoading: false,
            storageMode: null,
            homeUrl: 'https://target-home.example.test',
            onApprove: vi.fn(),
            onReject: vi.fn(),
        };
        const screen = await renderScreen(<TerminalConnectSurface state={state} />);
        expect(screen.findByTestId('terminal-connect-approve')?.props.disabled).toBe(true);
        expect(screen.getTextContent()).not.toContain('terminal.endToEndEncrypted');
    });
});
