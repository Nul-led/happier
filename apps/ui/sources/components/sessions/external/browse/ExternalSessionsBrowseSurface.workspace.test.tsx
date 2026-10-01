import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { DestinationInstanceHost } from '@/components/appShell/workspace/DestinationInstanceHost';
import { ExternalSessionsBrowseSurface } from './ExternalSessionsBrowseModal';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({ Platform: { OS: 'web' } }));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
// Client data is empty; the real Browse selection, capability and content owners remain mounted.
vi.mock('@/sync/domains/state/storage', async () => (await import('@/dev/testkit/mocks/storage')).createStorageModuleStub({}));
vi.mock('expo-router', async () => {
    const module = (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module;
    return { ...module, useRouter: () => { throw new Error('Browse body has no Expo navigator'); } };
});
// Portals and native modal presentation are the boundary, not the Browse content.
vi.mock('@/modal/components/CustomModal', () => ({
    CustomModal: () => React.createElement('BrowseModalBoundary'),
}));

afterEach(async () => { await standardCleanup(); });

describe('Browse surface workspace host', () => {
    it('renders the real Browse content inside its destination rather than opening a modal', async () => {
        const screen = await renderScreen(<DestinationInstanceHost tabId="browse"
            ref={{ kind: 'browseExistingSessions', params: {} }} pathname="/external/browse" focused visible
            navigation={{ push: () => {}, replace: () => {}, back: () => {} }}>
            <ExternalSessionsBrowseSurface lockScope={null} onRequestClose={() => {}} />
        </DestinationInstanceHost>);
        expect(screen.findByTestId('direct-sessions-browse-modal')).not.toBeNull();
        expect(screen.root.findAllByType('BrowseModalBoundary')).toHaveLength(0);
    });

    it('keeps the web modal presentation outside a workspace destination', async () => {
        const screen = await renderScreen(<ExternalSessionsBrowseSurface lockScope={null} onRequestClose={() => {}} />);
        expect(screen.root.findAllByType('BrowseModalBoundary')).toHaveLength(1);
        expect(screen.findByTestId('direct-sessions-browse-modal')).toBeNull();
    });
});
