import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen, standardCleanup } from '@/dev/testkit';

const clipboard = vi.hoisted(() => ({ write: vi.fn(async (_value: string) => true) }));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: clipboard.write,
}));

describe('WebDesktopRemoteSshHandoffContent', () => {
    afterEach(() => {
        clipboard.write.mockClear();
        standardCleanup();
    });

    it('offers the exact retained descriptor when an unlinked Iroh-only Home cannot use Account Service discovery', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_iroh',
            canonicalServerUrl: 'http://127.0.0.1:3005',
            revision: 1,
            endpoints: [{
                kind: 'iroh' as const,
                endpointId: 'endpoint-1',
                relayUrls: ['https://relay.example.test'],
            }],
        };
        const { WebDesktopRemoteSshHandoffContent } = await import('./WebDesktopRemoteSshHandoffContent');
        const screen = await renderScreen(React.createElement(WebDesktopRemoteSshHandoffContent, {
            testID: 'remote-handoff',
            draft: {
                username: '', host: '', port: '', authMode: 'agent', identityFilePath: '', password: '',
            },
            onDraftChange: vi.fn(),
            relayUrl: descriptor.canonicalServerUrl,
            homeConnectionDescriptor: descriptor,
            homeProfileSource: 'desktop-personal-home',
            installRelayRuntime: false,
        }));

        expect(screen.findByTestId('remote-handoff-terminal')).toBeTruthy();
        expect(screen.getTextContent()).toContain('--home-descriptor-file ./happier-home.json');
        expect(screen.getTextContent()).not.toContain('--home-url http://127.0.0.1:3005');
        const copyAction = screen.findByTestId('remote-handoff-copy-descriptor');
        expect(copyAction).toBeTruthy();
        await pressTestInstanceAsync(copyAction!, 'remote-handoff-copy-descriptor');
        expect(clipboard.write).toHaveBeenCalledOnce();
        expect(JSON.parse(String(clipboard.write.mock.calls[0]?.[0]))).toEqual(descriptor);
    });
});
