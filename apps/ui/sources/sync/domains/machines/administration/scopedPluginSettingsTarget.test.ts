import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import {
    resolveAdministrationScopedPluginSettingsTarget,
    useScopedPluginSettingsDaemonTargetBinding,
} from './scopedPluginSettingsTarget';

type TestMachine = {
    id: string;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    revokedAt: number | null;
    replacedByMachineId?: string | null;
    metadataVersion: number;
    metadata: null;
    daemonStateVersion: number;
};

type TestSelection = { serverIdentityId: string; machineId: string };

type TestStoreState = {
    isDataReady: boolean;
    machines: Record<string, TestMachine>;
    machineListByServerId: Record<string, TestMachine[]>;
    machineListStatusByServerId: Record<string, 'idle' | 'loading' | 'signedOut' | 'error'>;
    settings: {
        machineAdministrationSelectionsV1: { targetsByKey: Record<string, TestSelection> };
    };
};

const runtime = vi.hoisted(() => ({
    activeServerId: 'local-a',
    state: {} as unknown as TestStoreState,
    selections: { targetsByKey: {} } as { targetsByKey: Record<string, TestSelection> },
    /** New array identity per call: every render rebuilds the aggregate selection object. */
    snapshots: () => [] as unknown[],
}));

vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => runtime.state },
}));

vi.mock('@/sync/domains/state/warmCachePersistence', () => ({
    loadMachineDisplayWarmCacheEntries: () => ({}),
}));

vi.mock('@/sync/domains/machines/useMachineInventorySnapshots', () => ({
    useAllProfileMachineInventorySnapshots: () => runtime.snapshots(),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: runtime.activeServerId, serverUrl: '', generation: 1 }),
}));

const profileB = {
    id: 'local-b',
    name: 'Server B',
    serverUrl: 'https://b.example.test',
    serverIdentityId: 'srv_server_b',
    legacyServerIds: ['legacy-b'],
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
};

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    listServerProfiles: () => [profileB],
    areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => {
        const profileByIdentifier: Readonly<Record<string, string>> = {
            'local-a': 'local-a',
            'local-b': 'local-b',
            'legacy-b': 'local-b',
            srv_server_b: 'local-b',
        };
        return profileByIdentifier[String(left)] === profileByIdentifier[String(right)];
    },
    resolveServerProfileForPortableIdentity: (serverIdentityId: string) => (
        serverIdentityId === 'srv_server_b'
            ? { kind: 'resolved', serverIdentityId, profile: profileB }
            : { kind: 'missing', serverIdentityId }
    ),
}));

vi.mock('@/sync/store/hooks', () => ({
    useSetting: () => runtime.selections,
    // A null hydrated settings version keeps the sole-candidate initialization
    // effect inert; the persisted selection below is the only authority here.
    useSettingsVersion: () => null,
    useActiveServerAccountScope: () => ({ serverId: runtime.activeServerId, accountId: 'account-1' }),
}));

function machine(overrides: Partial<TestMachine> = {}): TestMachine {
    return {
        id: 'machine-b',
        createdAt: 1,
        updatedAt: 100,
        active: true,
        activeAt: Date.now(),
        revokedAt: null,
        metadataVersion: 1,
        metadata: null,
        daemonStateVersion: 5,
        ...overrides,
    };
}

/**
 * Boots the exact raw owner state `resolveFreshMachineAdministrationExecutionTarget`
 * re-reads on every invocation, with the portable selection persisted under the
 * canonical Plugins administration key and reached through a non-active server
 * profile.
 */
function bootstrapRuntime(): void {
    runtime.activeServerId = 'local-a';
    runtime.selections = {
        targetsByKey: {
            'plugins.home': { serverIdentityId: 'srv_server_b', machineId: 'machine-b' },
        },
    };
    runtime.snapshots = () => [];
    runtime.state = {
        isDataReady: true,
        machines: {},
        machineListByServerId: {
            srv_server_b: [machine(), machine({ id: 'machine-c' })],
        },
        machineListStatusByServerId: { srv_server_b: 'idle' },
        settings: { machineAdministrationSelectionsV1: runtime.selections },
    };
}

function renderBinding() {
    return renderHook(
        () => useScopedPluginSettingsDaemonTargetBinding('plugins.home'),
    );
}

describe('useScopedPluginSettingsDaemonTargetBinding', () => {
    beforeEach(() => {
        bootstrapRuntime();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('preserves the exact execution-target reference and currentness callbacks across rerenders when the resolution is semantically unchanged', async () => {
        const hook = await renderBinding();
        const first = hook.getCurrent();
        expect(first.executionTarget).not.toBeNull();
        expect(first.executionTarget?.machine.daemonStateVersion).toBe(5);

        const second = await hook.rerender();
        const third = await hook.rerender();

        // `resolveExecutionTarget()` freezes a fresh object per call, but the
        // binding canonicalizes it: unchanged server, machine, daemon
        // generation, and selection revision are the same fact, so consumers'
        // effect inputs must keep one stable reference instead of re-running
        // on every presentation render.
        expect(second.executionTarget).toBe(first.executionTarget);
        expect(third.executionTarget).toBe(first.executionTarget);
        // An aggregate selection object rebuilt on every render must not churn
        // the currentness callbacks: they consume only the stable resolver.
        expect(second.resolveCurrentExecutionTarget).toBe(first.resolveCurrentExecutionTarget);
        expect(third.resolveCurrentExecutionTarget).toBe(first.resolveCurrentExecutionTarget);
        expect(second.isTargetCurrent).toBe(first.isTargetCurrent);

        // The fence still re-resolves at invocation time and passes unchanged truth.
        const current = first.resolveCurrentExecutionTarget(first.executionTarget);
        expect(current).not.toBeNull();
        expect(current?.machine.daemonStateVersion).toBe(5);
        const scopedTarget = resolveAdministrationScopedPluginSettingsTarget(first.executionTarget);
        expect(scopedTarget).not.toBeNull();
        expect(first.isTargetCurrent(scopedTarget!)).toBe(true);
    });

    it('produces a new execution-target reference when the daemon generation changes', async () => {
        const hook = await renderBinding();
        const first = hook.getCurrent();
        const staleScopedTarget = resolveAdministrationScopedPluginSettingsTarget(first.executionTarget);
        expect(staleScopedTarget).not.toBeNull();

        runtime.state = {
            ...runtime.state,
            machineListByServerId: {
                srv_server_b: [machine({ daemonStateVersion: 6 }), machine({ id: 'machine-c' })],
            },
        };
        const second = await hook.rerender();

        expect(second.executionTarget).not.toBe(first.executionTarget);
        expect(second.executionTarget?.machine.id).toBe('machine-b');
        expect(second.executionTarget?.machine.daemonStateVersion).toBe(6);
        // The freshness fence rejects the target captured before the bump…
        expect(first.isTargetCurrent(staleScopedTarget!)).toBe(false);
        // …and accepts the fresh one.
        const freshScopedTarget = resolveAdministrationScopedPluginSettingsTarget(second.executionTarget);
        expect(freshScopedTarget).not.toBeNull();
        expect(second.isTargetCurrent(freshScopedTarget!)).toBe(true);
    });

    it('still refreshes the reference when the selection returns to the same machine (A -> B -> A)', async () => {
        const hook = await renderBinding();
        const original = hook.getCurrent().executionTarget;
        expect(original?.machine.id).toBe('machine-b');

        runtime.selections.targetsByKey['plugins.home'] = {
            serverIdentityId: 'srv_server_b',
            machineId: 'machine-c',
        };
        await hook.rerender();

        runtime.selections.targetsByKey['plugins.home'] = {
            serverIdentityId: 'srv_server_b',
            machineId: 'machine-b',
        };
        const returned = await hook.rerender();

        // Selection revision is part of the authority identity: returning to
        // the same machine is a new selection fact, so canonicalization must
        // not hand back the earlier reference.
        expect(returned.executionTarget).not.toBe(original);
        expect(returned.executionTarget?.machine.id).toBe('machine-b');
        expect(returned.executionTarget?.serverId).toBe('local-b');
    });
});
