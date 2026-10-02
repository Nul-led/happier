import * as React from 'react';
import { act } from 'react-test-renderer';
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
    it('renames an existing group inline, keeping a cancelled draft out of persistence', async () => {
        const profiles = new MMKV({ id: scopedStorageId('server-profiles', process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE!) });
        const state = JSON.parse(profiles.getString('server-state-v1')!);
        state.homeViewState.groups = [
            { id: 'group-a', name: 'Original', serverIds: ['home-a'], presentation: 'grouped' },
            { id: 'group-b', name: 'Other', serverIds: ['home-b'], presentation: 'grouped' },
        ];
        profiles.set('server-state-v1', JSON.stringify(state));
        const { HomeGroupPage } = await import('./HomeGroupPage');
        const { HomesCollectionProvider } = await import('./HomesCollection');
        const screen = await renderScreen(<HomesCollectionProvider><HomeGroupPage groupId="group-a" /></HomesCollectionProvider>);
        const openRename = async () => {
            // Native portals do not mount their menu rows in this renderer; drive the real
            // dropdown's public selection event without replacing its menu/action logic.
            const menu = screen.findAllByProps({ testID: 'settings.homes.group.menu' })
                .find((node) => typeof node.props.onSelect === 'function');
            expect(menu).toBeDefined();
            await act(async () => { await menu!.props.onSelect('rename'); });
        };
        await openRename();
        const field = screen.findByTestId('settings.homes.group.name');
        expect(field).not.toBeNull();
        await act(async () => { field!.props.onChangeText('Cancelled'); });
        await screen.pressByTestIdAsync('settings.homes.group.name.cancel');
        expect(JSON.parse(profiles.getString('server-state-v1')!).homeViewState.groups[0].name).toBe('Original');
        await openRename();
        await act(async () => { screen.findByTestId('settings.homes.group.name')!.props.onChangeText(' Renamed '); });
        await screen.pressByTestIdAsync('settings.homes.group.name.save');
        expect(JSON.parse(profiles.getString('server-state-v1')!).homeViewState.groups[0].name).toBe('Renamed');
        await openRename();
        await act(async () => { screen.findByTestId('settings.homes.group.name')!.props.onChangeText('Do not apply to another group'); });
        await screen.update(<HomesCollectionProvider><HomeGroupPage groupId="group-b" /></HomesCollectionProvider>);
        expect(screen.findByTestId('settings.homes.group.name') === null).toBe(true);
        expect(JSON.parse(profiles.getString('server-state-v1')!).homeViewState.groups[1].name).toBe('Other');
    });

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
