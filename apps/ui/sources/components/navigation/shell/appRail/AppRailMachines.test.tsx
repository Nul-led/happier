import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import type { Machine } from '@/sync/domains/state/storageTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);

afterEach(() => {
    standardCleanup();
});

const DAY_MS = 24 * 60 * 60 * 1000;

function machine(id: string, overrides: Partial<Machine> = {}): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1000,
        updatedAt: 1000,
        active: true,
        activeAt: Date.now(),
        metadata: { host: id, platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 0,
        revokedAt: null,
        ...overrides,
    };
}

function setHomeMachines(machines: readonly Machine[]) {
    const activeServerId = String(getActiveServerSnapshot().serverId ?? '').trim() || 'server-active';
    storage.setState((state) => ({
        ...state,
        machines: {},
        machineListByServerId: { ...state.machineListByServerId, [activeServerId]: [...machines] },
    }));
}

describe('AppRailMachines', () => {
    it('names the counts on the closed icon, draws no badge for machines that are merely offline, and stays still on heartbeats', async () => {
        const previousState = storage.getState();
        try {
            setHomeMachines([
                machine('laptop'),
                machine('devbox'),
                machine('studio', { active: false, activeAt: Date.now() - 2 * DAY_MS }),
            ]);
            const { AppRailMachines } = await import('./AppRailMachines');
            let commits = 0;
            const screen = await renderScreen(
                <React.Profiler id="rail-machines" onRender={() => { commits += 1; }}>
                    <AppRailMachines />
                </React.Profiler>,
            );
            await flushHookEffects({ cycles: 2 });

            const button = screen.findByTestId('app-rail-machines');
            expect(button?.props.accessibilityLabel).toContain('settings.machines');
            expect(button?.props.accessibilityLabel).toContain('settingsOverview.machinesOnlineCount(count=2)');
            expect(button?.props.accessibilityLabel).toContain('settingsOverview.machinesOfflineCount(count=1)');
            // M3: offline is not a problem, so the icon carries no badge; the popover is not mounted.
            expect(screen.findByTestId('app-rail-machines-badge')).toBeNull();
            expect(screen.findByTestId('sidebar-machines-popover-content')).toBeNull();

            const commitsBefore = commits;
            await act(async () => {
                setHomeMachines([
                    machine('laptop', { activeAt: Date.now(), metadataVersion: 2 }),
                    machine('devbox', { activeAt: Date.now() }),
                    machine('studio', { active: false, activeAt: Date.now() - 2 * DAY_MS, updatedAt: 2000 }),
                ]);
            });
            expect(commits).toBe(commitsBefore);
        } finally {
            storage.setState(previousState);
        }
    });
});
