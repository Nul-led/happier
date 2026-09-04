import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const inspect = vi.hoisted(() => vi.fn());
const machineState = vi.hoisted(() => ({
    machines: [{ id: 'machine-local', metadata: { displayName: 'This computer' } }] as readonly Record<string, unknown>[],
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useAllMachines: () => machineState.machines,
}));
vi.mock('@/components/settings/machines/localControl/useLocalDaemonControl', () => ({
    useLocalDaemonControl: () => ({ status: { machineId: 'machine-local' } }),
}));
vi.mock('@/sync/ops/workspaceSync', () => ({ inspectWorkspaceSyncLegacyState: inspect }));
vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => true,
    invokeDesktopHost: vi.fn(),
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('ItemGroup', props, props.children),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('Item', props, props.children),
}));

describe('WorkspaceSyncLegacyStateRecovery', () => {
    beforeEach(() => {
        inspect.mockReset();
        machineState.machines = [{ id: 'machine-local', metadata: { displayName: 'This computer' } }];
    });

    it('reports an old daemon without the inspection RPC as update-required, not as a detector failure', async () => {
        inspect.mockRejectedValue(Object.assign(new Error('RPC method not available'), { rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE }));
        const { WorkspaceSyncLegacyStateRecovery } = await import('./WorkspaceSyncLegacyStateRecovery');
        const screen = await renderScreen(<WorkspaceSyncLegacyStateRecovery />);
        await act(async () => undefined);

        expect(screen.findByTestId('workspace-sync-legacy-outdated-machine-local')).not.toBeNull();
        expect(screen.findAllByType('Item').some((item) => item.props.testID === 'workspace-sync-legacy-inspection-failed')).toBe(false);
    });

    it('uses machine daemon version evidence to report a released daemon that predates the inspection RPC', async () => {
        machineState.machines = [{ id: 'machine-local', metadata: { displayName: 'This computer' }, daemonState: { cliVersion: '0.2.11' } }];
        inspect.mockRejectedValue(new Error('machine offline'));
        const { WorkspaceSyncLegacyStateRecovery } = await import('./WorkspaceSyncLegacyStateRecovery');
        const screen = await renderScreen(<WorkspaceSyncLegacyStateRecovery />);
        await act(async () => undefined);

        expect(screen.findByTestId('workspace-sync-legacy-outdated-machine-local')).not.toBeNull();
        expect(screen.findAllByType('Item').some((item) => item.props.testID === 'workspace-sync-legacy-inspection-failed')).toBe(false);
    });

    it('still reports an inspection failure as a detector failure when the daemon is current', async () => {
        machineState.machines = [{ id: 'machine-local', metadata: { displayName: 'This computer' }, daemonState: { cliVersion: '9.0.0' } }];
        inspect.mockRejectedValue(new Error('detector crashed'));
        const { WorkspaceSyncLegacyStateRecovery } = await import('./WorkspaceSyncLegacyStateRecovery');
        const screen = await renderScreen(<WorkspaceSyncLegacyStateRecovery />);
        await act(async () => undefined);

        expect(screen.findByTestId('workspace-sync-legacy-inspection-failed')).not.toBeNull();
        expect(screen.findAllByType('Item').some((item) => String(item.props.testID ?? '').startsWith('workspace-sync-legacy-outdated'))).toBe(false);
    });

    it('shows the exact copyable quarantine and offline-only recovery without a delete action', async () => {
        inspect.mockResolvedValue({
            status: 'legacy_workspace_sync_state_unsupported',
            classification: 'retired_v1',
            quarantinePath: '/private/quarantine/workspace-replication.retired-v1-123-x',
            schemaVersion: 1,
        });
        const { WorkspaceSyncLegacyStateRecovery } = await import('./WorkspaceSyncLegacyStateRecovery');
        const screen = await renderScreen(<WorkspaceSyncLegacyStateRecovery />);
        await act(async () => undefined);

        expect(screen.findByTestId('workspace-sync-legacy-quarantine-machine-local')?.props.copy)
            .toBe('/private/quarantine/workspace-replication.retired-v1-123-x');
        expect(screen.findByTestId('workspace-sync-legacy-open-machine-local')).not.toBeNull();
        expect(screen.findByTestId('workspace-sync-legacy-offline-machine-local')?.props.subtitle)
            .toContain('/private/quarantine/workspace-replication.retired-v1-123-x');
        expect(screen.findAllByType('Item').some((item) => String(item.props.title).toLowerCase().includes('delete'))).toBe(false);
    });

    it('preserves the last known quarantine path when read-only reinspection fails', async () => {
        inspect
            .mockResolvedValueOnce({
                status: 'legacy_workspace_sync_state_unsupported',
                classification: 'retired_v1',
                quarantinePath: '/private/quarantine/workspace-replication.retired-v1-123-x',
                schemaVersion: 1,
            })
            .mockRejectedValueOnce(new Error('machine offline'));
        const { WorkspaceSyncLegacyStateRecovery } = await import('./WorkspaceSyncLegacyStateRecovery');
        const screen = await renderScreen(<WorkspaceSyncLegacyStateRecovery />);
        await act(async () => undefined);

        await act(async () => {
            screen.findAllByType('Item')
                .find((item) => item.props.title === 'workspaceSync.legacyRecovery.reinspect')
                ?.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.findByTestId('workspace-sync-legacy-quarantine-machine-local')?.props.copy)
            .toBe('/private/quarantine/workspace-replication.retired-v1-123-x');
        expect(screen.findByTestId('workspace-sync-legacy-inspection-failed')).not.toBeNull();
    });
});
