import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { ConnectedServiceSetupPanel, type ConnectedServiceSetupCatalogEntry } from './ConnectedServiceSetupPanel';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
// This setup journey does not render Markdown; fail if the unavailable third-party export is used.
vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({
    splitStreamingRevealTextParts: () => { throw new Error('Unexpected streaming Markdown in account setup'); },
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
// The media-query boundary selects a real animated collapse; timing stays pending until the driver settles.
vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => false,
    readReducedMotionPreference: () => false,
}));

afterEach(standardCleanup);

const tool: ConnectedServiceSetupCatalogEntry = {
    serviceKey: 'happier.scm.forge.github/github-account',
    service: { pluginId: 'happier.scm.forge.github', localId: 'github-account' },
    entry: null,
    legacyServiceId: 'github',
    label: 'GitHub',
    usedBy: [],
    usedByAgentIds: [],
    connectedCount: 0,
    section: 'tools',
    canAdd: true,
};

describe('ConnectedServiceSetupPanel tools disclosure', () => {
    it('keeps the tools mounted while their collapse runs, with one accessible toggle', async () => {
        const screen = await renderScreen(<ConnectedServiceSetupPanel
            target={{ kind: 'catalog' }}
            catalog={[tool]}
            onTargetChange={() => {}}
            onClose={() => {}}
            renderServiceFlow={() => null}
        />);
        expect(screen.findByTestId('connected-service-setup:tools-catalog')).toBeNull();
        await screen.pressByTestIdAsync('connected-service-setup:tools');
        expect(screen.findByTestId('connected-service-setup:tools-catalog')).toBeTruthy();
        await screen.pressByTestIdAsync('connected-service-setup:tools');
        expect(screen.findHostByTestId('connected-service-setup:tools')?.props.accessibilityState?.expanded).toBe(false);
        expect(screen.findByTestId('connected-service-setup:tools-catalog')).toBeTruthy();
    });
});
