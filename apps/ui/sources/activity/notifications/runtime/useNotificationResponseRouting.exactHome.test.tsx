import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_NOTIFICATION_ACTION_IDS } from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

// Native notification module boundary: the test delivers responses through its listener.
const notifications = vi.hoisted(() => ({
    listener: null as ((response: unknown) => void) | null,
}));
vi.mock('@/utils/platform/loadExpoNotifications', () => ({
    loadExpoNotifications: async () => ({
        DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
        getLastNotificationResponseAsync: async () => null,
        addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
            notifications.listener = listener;
            return { remove: () => { notifications.listener = null; } };
        },
    }),
}));

// Session RPC transport boundary: records which Home each permission response targets.
const rpc = vi.hoisted(() => ({ calls: [] as Array<Readonly<{ serverId: string | undefined; method: string; payload: unknown }>> }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc')>()),
    sessionRpcWithServerScope: async (params: Readonly<{ serverId?: string; method: string; payload: unknown }>) => {
        rpc.calls.push({ serverId: params.serverId, method: params.method, payload: params.payload });
        return undefined;
    },
}));

// Connection-switch boundary: resolves without moving focus, so the dispatch happens
// while another Home is (still, or again) focused.
const switching = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/sync/domains/server/activeServerSwitch', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/activeServerSwitch')>(),
    setActiveServerAndSwitch: async (params: Readonly<{ serverId: string }>) => {
        switching.calls.push(params.serverId);
        return 'switched';
    },
    upsertActivateAndSwitchServer: async () => 'blocked',
}));

// `@/sync/ops` pulls the Sync singleton only for unrelated operations.
vi.mock('@/sync/sync', () => ({ sync: {} }));

const SESSION_ID = 'same-session';
const REQUEST_ID = 'same-request';

function permissionResponse(params: Readonly<{ serverId: string; serverUrl: string; identifier: string }>) {
    return {
        actionIdentifier: PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1,
        notification: {
            request: {
                identifier: params.identifier,
                content: {
                    data: {
                        serverId: params.serverId,
                        serverUrl: params.serverUrl,
                        sessionId: SESSION_ID,
                        requestId: REQUEST_ID,
                    },
                },
            },
        },
    };
}

async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(condition()).toBe(true);
}

async function setupHomes() {
    const { upsertServerProfile, setActiveServerId } = await import('@/sync/domains/server/serverProfiles');
    const { storage } = await import('@/sync/domains/state/storage');
    const homeA = await upsertServerProfile({ serverUrl: 'https://home-a.example.test', name: 'Home A', source: 'manual' });
    const homeB = await upsertServerProfile({ serverUrl: 'https://home-b.example.test', name: 'Home B', source: 'manual' });
    // The same Session id is also a listed Session on Home B: local evidence that
    // points the bare id at B, as the list owner produces for a duplicate id.
    storage.setState((state) => ({
        ...state,
        ordinarySessionListMembershipByServerId: {
            ...state.ordinarySessionListMembershipByServerId,
            [homeB.id]: [SESSION_ID],
        },
    }));
    return { homeA, homeB, setActiveServerId };
}

async function mountRouting() {
    const { useNotificationResponseRouting } = await import('./useNotificationResponseRouting');
    function Probe() {
        useNotificationResponseRouting({ enabled: true, refreshAuth: async () => {} });
        return null;
    }
    await renderScreen(React.createElement(Probe));
}

describe('useNotificationResponseRouting exact-Home permission dispatch', () => {
    beforeEach(() => {
        vi.resetModules();
        notifications.listener = null;
        rpc.calls.length = 0;
        switching.calls.length = 0;
    });

    afterEach(() => {
        standardCleanup();
    });

    it('sends Allow to the notification\'s focused Home, not to the Home a bare id resolves to', async () => {
        const { homeA, setActiveServerId } = await setupHomes();
        await setActiveServerId(homeA.id);
        await mountRouting();
        await waitFor(() => notifications.listener !== null);

        notifications.listener!(permissionResponse({ serverId: homeA.id, serverUrl: homeA.serverUrl, identifier: 'n-active' }));
        await waitFor(() => rpc.calls.length === 1);

        expect(rpc.calls[0]).toMatchObject({ serverId: homeA.id, payload: expect.objectContaining({ id: REQUEST_ID, approved: true }) });
    });

    it('sends Allow to the saved Home it switched to, even when another Home is focused at dispatch', async () => {
        const { homeA, homeB, setActiveServerId } = await setupHomes();
        await setActiveServerId(homeB.id);
        await mountRouting();
        await waitFor(() => notifications.listener !== null);

        notifications.listener!(permissionResponse({ serverId: homeA.id, serverUrl: homeA.serverUrl, identifier: 'n-saved' }));
        await waitFor(() => rpc.calls.length === 1);

        expect(switching.calls).toEqual([homeA.id]);
        expect(rpc.calls[0]!.serverId).toBe(homeA.id);
    });

    it('replays a pending Allow against the Home it was recorded for', async () => {
        const { homeA, setActiveServerId } = await setupHomes();
        const { setPendingNotificationAction } = await import('@/sync/domains/pending/pendingNotificationAction');
        await setActiveServerId(homeA.id);
        setPendingNotificationAction({
            serverUrl: homeA.serverUrl,
            serverId: homeA.id,
            sessionId: SESSION_ID,
            requestId: REQUEST_ID,
            action: 'allow',
        });

        await mountRouting();
        await waitFor(() => rpc.calls.length === 1);

        expect(rpc.calls[0]!.serverId).toBe(homeA.id);
    });
});
