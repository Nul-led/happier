import * as React from 'react';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { scopedStorageId } from '@/utils/system/storageScope';

const routes = createExpoRouterMock();
vi.mock('expo-router', () => routes.module);
// Authentication, native UI and locale are environment boundaries. Collection,
// controller, profile persistence, group actions and membership controls stay real.
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, refreshFromActiveServer: async () => {} }),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

beforeEach(() => {
    vi.resetModules();
    routes.resetParams();
    const scope = `home-group-draft-${crypto.randomUUID()}`;
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', scope);
    vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_CONTEXT', '');
    const profiles = new MMKV({ id: scopedStorageId('server-profiles', scope) });
    profiles.set('server-state-v1', JSON.stringify({
        activeServerId: 'home-a',
        activeServerIdIsExplicit: true,
        servers: Object.fromEntries(['home-a', 'home-b', 'home-c'].map((id) => [id, {
            id, name: id, serverUrl: `https://${id}.example.test`,
            createdAt: 1, updatedAt: 1, lastUsedAt: 1, source: 'manual',
        }])),
        homeViewStateInitialized: true,
        homeViewState: { version: 1, groups: [], activeTargetKind: 'server', activeTargetId: 'home-a' },
    }));
});

afterEach(() => {
    standardCleanup();
    vi.unstubAllEnvs();
});

async function renderDraft() {
    const { HomeGroupPage } = await import('./HomeGroupPage');
    const { HomesCollectionProvider } = await import('./HomesCollection');
    return renderScreen(<HomesCollectionProvider><HomeGroupPage groupId={null} /></HomesCollectionProvider>);
}

describe('Home group draft', () => {
    it('honors an explicit empty seed instead of selecting the Home in use', async () => {
        routes.state.router.setParams({ groupServerIds: '[]' });
        const screen = await renderDraft();
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-a')?.props['aria-checked']).toBe(false);
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-b')?.props['aria-checked']).toBe(false);
    });

    it('seeds only a bare draft from the Home in use', async () => {
        const screen = await renderDraft();
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-a')?.props['aria-checked']).toBe(true);
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-b')?.props['aria-checked']).toBe(false);
    });

    it('takes a requested seed once without overwriting membership edits', async () => {
        routes.state.router.setParams({ groupServerIds: '["home-a","home-b","home-b"]' });
        const screen = await renderDraft();
        await screen.pressByTestIdAsync('settings.homes.groupDraft.member.home-b');
        routes.state.router.setParams({ groupServerIds: '["home-b","home-c"]' });
        const { HomeGroupPage } = await import('./HomeGroupPage');
        const { HomesCollectionProvider } = await import('./HomesCollection');
        await screen.update(<HomesCollectionProvider><HomeGroupPage groupId={null} /></HomesCollectionProvider>);
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-a')?.props['aria-checked']).toBe(true);
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-b')?.props['aria-checked']).toBe(false);
        expect(screen.findByTestId('settings.homes.groupDraft.member.home-c')?.props['aria-checked']).toBe(false);
    });

    it('keeps the group name associated with its persistent label', async () => {
        const screen = await renderDraft();
        expect(screen.findByTestId('settings.homes.groupDraft.name')?.props).toMatchObject({
            accessibilityLabelledBy: 'settings-homes-group-name-label',
        });
    });
});
