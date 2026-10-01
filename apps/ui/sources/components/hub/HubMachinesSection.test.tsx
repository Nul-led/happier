import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineAgentInventoryItem } from '@happier-dev/protocol/capabilities';

import { createMachineFixture, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { serverAccountScopedResourceKey } from '@/sync/domains/scope/serverAccountScope';
import { machineAgentInventoryStore } from '@/agents/machineAgents/machineAgentInventoryStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let serverId = '';
const rpc = vi.hoisted(() => vi.fn());

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
    return createTextModuleMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
// Expo's native crypto module is unavailable in the Node renderer; retain real OS randomness.
vi.mock('expo-crypto', async () => {
    const { randomBytes, randomUUID } = await import('node:crypto');
    return { randomUUID, getRandomBytes: (size: number) => new Uint8Array(randomBytes(size)),
        getRandomBytesAsync: async (size: number) => new Uint8Array(randomBytes(size)) };
});
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({ importOriginal, tokenStorage: {
        getCredentialsForServerUrl: async () => ({ token: `header.${Buffer.from(JSON.stringify({ sub: 'hub-inventory-account' })).toString('base64')}.signature` }),
    } });
});

beforeEach(async () => {
    const server = await upsertServerProfile({ serverUrl: 'https://hub-inventory.example.test' });
    serverId = server.id;
    await setActiveServerId(serverId);
});

afterEach(() => {
    standardCleanup();
    rpc.mockClear();
    storage.setState(storage.getInitialState(), true);
});

// Presence is read against the clock when the section renders, so each fixture is stamped when made.
const online = (id: string, host: string) => createMachineFixture({ id, active: true, activeAt: Date.now(), metadata: { host, displayName: host } });
const offline = (id: string, host: string) => createMachineFixture({ id, active: false, activeAt: Date.now() - 5 * 24 * 60 * 60 * 1000, metadata: { host, displayName: host } });
function setMachines(machines: ReturnType<typeof online>[]) {
    storage.setState({ machineListByServerId: { [serverId]: machines }, profileScope: { serverId, accountId: 'hub-inventory-account' } });
}

async function renderSection() {
    const [{ HubMachinesSection }, { ListPresentationProvider }] = await Promise.all([
        import('./HubMachinesSection'),
        import('@/components/ui/lists/listPresentation'),
    ]);
    // The Settings Overview and the home are pages: section actions ("As of") live in page headers.
    const screen = await renderScreen(<ListPresentationProvider value="page"><HubMachinesSection /></ListPresentationProvider>);
    await flushHookEffects({ cycles: 3 });
    return screen;
}

describe('HubMachinesSection', () => {
    it('is absent while this Home has no machine', async () => {
        const screen = await renderSection();
        expect(screen.getTextContent()).not.toContain('settingsOverview.machinesTitle');
    });

    it('says an offline machine is offline and when it was last seen, without agents or an "as of"', async () => {
        setMachines([offline('m-off', 'studio')]);
        const screen = await renderSection();

        const card = screen.findByTestId('hub-machines.m-off');
        expect(card).toBeTruthy();
        expect(screen.findByTestId('hub-machines.m-off.status')?.props.accessibilityLabel).toBe('systemStatus.machine.offline');
        expect(screen.getTextContent()).toContain('settingsOverview.machineLastSeen');
        expect(screen.findByTestId('hub-machines.m-off.agents')).toBeNull();
        expect(screen.findByTestId('hub-machines.asOf')).toBeNull();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('lays the machines out as cards under a header that counts them online and offline', async () => {
        setMachines([online('m-on', 'devbox'), online('m-two', 'laptop'), offline('m-off', 'studio')]);
        const screen = await renderSection();

        expect(screen.findByTestId('hub-machines.grid')).toBeTruthy();
        expect(screen.findByTestId('hub-machines.presence')?.props.accessibilityLabel)
            .toBe('settingsOverview.machinesOnlineCount(count=2) · settingsOverview.machinesOfflineCount(count=1)');
        expect(screen.findByTestId('hub-machines.m-on.status')?.props.accessibilityLabel).toBe('systemStatus.machine.online');
        expect(screen.findByTestId('hub-machines.m-off.status')?.props.accessibilityLabel).toBe('systemStatus.machine.offline');
    });

    it('shows installed canonical inventory facts with their read time without probing the machine', async () => {
        const item: MachineAgentInventoryItem = {
            agentId: 'claude', title: 'Claude', installed: true, version: '1', latestVersion: null,
            update: { supported: false, command: null }, signIn: { status: 'unknown', loginSupport: 'status_only' },
            platform: { supported: true }, install: { available: false, mode: 'manual', sizeBytes: null, guideUrl: null }, dependencies: [],
        };
        machineAgentInventoryStore.publish(serverAccountScopedResourceKey({ serverId, accountId: 'hub-inventory-account' }, 'machine-agents', 'm-on'), {
            status: 'ready', items: [item, { ...item, agentId: 'codex', installed: false }], lastCheckedAt: 12,
        });
        setMachines([online('m-on', 'devbox'), online('m-new', 'laptop')]);

        const screen = await renderSection();

        // Claude was found; Codex is missing there, so it is not a readiness mark.
        await vi.waitFor(() => expect(screen.findByTestId('hub-machines.m-on.agents')).toBeTruthy());
        expect(screen.findByTestId('machine-cli-logo:claude')).toBeTruthy();
        expect(screen.findByTestId('machine-cli-logo:codex')).toBeNull();
        // A machine nothing has detected yet shows no agents rather than a placeholder.
        expect(screen.findByTestId('hub-machines.m-new.agents')).toBeNull();
        expect(screen.findByTestId('hub-machines.asOf')).toBeTruthy();
        expect(rpc).not.toHaveBeenCalled();
    });
});
