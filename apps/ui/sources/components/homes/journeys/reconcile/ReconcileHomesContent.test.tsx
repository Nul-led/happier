import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';

const spies = vi.hoisted(() => ({
    push: vi.fn(),
    switchServer: vi.fn(async (_input: unknown) => 'switched' as const),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => '/', router: { push: spies.push } }).module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key, params) => params
            ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
            : key,
    });
});

// Focusing a Home reconnects this device's live transport to it: the process boundary this sheet
// crosses. Which Home is focused, and what follows, stay real.
vi.mock('@/sync/domains/server/activeServerSwitch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/server/activeServerSwitch')>()),
    setActiveServerAndSwitch: spies.switchServer,
}));

function home(id: string, name: string, url: string): ServerProfile {
    return { id, name, serverUrl: url, serverIdentityId: `srv_${id}`, createdAt: 1, updatedAt: 1, lastUsedAt: 1 };
}

const studio = home('studio', 'Studio Home', 'https://studio.example.test');
const personal = home('personal', 'Personal Home', 'http://127.0.0.1:4100');

describe('ReconcileHomesContent', () => {
    beforeEach(() => {
        spies.push.mockClear();
        spies.switchServer.mockClear();
    });

    it('keeps both Homes: settles the choice and changes nothing else', async () => {
        const settle = vi.fn();
        const onClose = vi.fn();
        const { ReconcileHomesContent } = await import('./ReconcileHomesSheet');
        const screen = await renderScreen(<ReconcileHomesContent found={[studio]} personal={personal} settle={settle} onClose={onClose} />);

        await screen.pressByTestIdAsync('reconcile-homes.keep-both');
        expect(settle).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(spies.switchServer).not.toHaveBeenCalled();
        expect(spies.push).not.toHaveBeenCalled();
        await screen.unmount();
    });

    it('uses the found Home: focuses it and hands this computer to its setup for that Home', async () => {
        const settle = vi.fn();
        const onClose = vi.fn();
        const { ReconcileHomesContent } = await import('./ReconcileHomesSheet');
        const screen = await renderScreen(<ReconcileHomesContent found={[studio]} personal={personal} settle={settle} onClose={onClose} />);

        expect(screen.findAllByTestId('reconcile-homes.use').find((node) => node.props.title !== undefined)?.props.title).toBe('homesJourneys.useHome(home=Studio Home)');
        await screen.pressByTestIdAsync('reconcile-homes.use');
        expect(settle).toHaveBeenCalledOnce();
        expect(spies.switchServer).toHaveBeenCalledWith({ serverId: 'studio', scope: 'device' });
        expect(spies.push).toHaveBeenCalledWith('/setup/wizard?action=local&step=setup_this_computer&scope=machine');
        await screen.unmount();
    });

    it('never offers to remove the Personal Home while the Home has not said it is empty', async () => {
        const { ReconcileHomesContent } = await import('./ReconcileHomesSheet');
        const screen = await renderScreen(<ReconcileHomesContent found={[studio]} personal={personal} settle={() => {}} onClose={() => {}} />);

        expect(screen.findByTestId('homes-journeys.remove-empty-personal-home')).toBeFalsy();
        await screen.unmount();
    });
});
