import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineProtocolObject } from '@happier-dev/plugin-sdk/protocol';

import { flushHookEffects, renderHook } from '@/dev/testkit';

const projectionState = vi.hoisted(() => ({
    revision: 0,
    listeners: new Set<() => void>(),
}));
const targetedReadMock = vi.hoisted(() => vi.fn());
const describeMock = vi.hoisted(() => vi.fn());
const activeAccountLifetime = vi.hoisted(() => ({
    value: null as null | Readonly<{
        scope: Readonly<{ serverId: string; accountId: string }>;
        isCurrent(): boolean;
        onRetire(cancel: () => void): Readonly<{ dispose(): void }>;
    }>,
}));

// The machine RPC transport is this owner's boundary; the revision registry is
// the real one so an invalidation behaves exactly as in the app.
vi.mock('@/sync/ops/machineContributionRegistryProjection', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/ops/machineContributionRegistryProjection')>()),
    machinePluginUiTargetedContributionsRead: targetedReadMock,
    machineContributionRegistryProjectionDescribe: describeMock,
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => activeAccountLifetime.value,
}));

vi.mock('@/sync/domains/plugins/ui/projectionWarmCache', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/plugins/ui/projectionWarmCache')>()),
    savePluginUiProjectionTargetedAdmissionSnapshot: vi.fn(),
}));

const sourceCustody = { kind: 'development', registeredRootId: 'triage-root' } as const;

function snapshot(occurrenceId: string) {
    return {
        target: { pluginId: 'acme.triage', occurrenceId, sourceCustody },
        points: [],
    };
}

function mount(occurrenceId: string) {
    return {
        kind: 'targetedSurface',
        target: { pluginId: 'acme.triage', occurrenceId, sourceCustody },
        inputSchema: defineProtocolObject({}, { policy: 'closed' }).jsonSchema,
    };
}

describe('useMountedTargetedContributions', () => {
    beforeEach(async () => {
        targetedReadMock.mockReset();
        describeMock.mockReset();
        activeAccountLifetime.value = Object.freeze({
            scope: Object.freeze({ serverId: 'server-1', accountId: 'account-a' }),
            isCurrent: () => true,
            onRetire: () => Object.freeze({ dispose: () => {} }),
        });
    });

    it('reads only the target slice and prepares its mounts', async () => {
        targetedReadMock.mockResolvedValue({
            supported: true,
            targetedContributions: snapshot('occurrence-a'),
            targetedSurfaceMounts: [mount('occurrence-a')],
        });
        const { useMountedTargetedContributions } = await import('./mountedTargetedContributions');

        const rendered = await renderHook(() => useMountedTargetedContributions({
            machineId: 'machine-1',
            serverId: 'server-1',
            pluginId: 'acme.triage',
            mountedOccurrenceId: 'occurrence-a',
            enabled: true,
        }));
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(rendered.getCurrent()).toMatchObject({
            phase: 'ready',
            targetedContributions: snapshot('occurrence-a'),
            failure: null,
        });
        expect(rendered.getCurrent().preparedTargetedSurfaceMounts?.[0]?.inputValidation).toBeDefined();
        expect(targetedReadMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({ serverId: 'server-1', pluginId: 'acme.triage' }));
        // The mount never asks for the machine-wide projection itself.
        expect(describeMock).not.toHaveBeenCalled();
    });

    it('follows a reloaded occurrence: asks the machine projection to refresh once instead of failing', async () => {
        const { getMachineContributionRegistryProjectionRevision } = await import('@/sync/ops/machineContributionRegistryProjection');
        targetedReadMock.mockResolvedValue({
            supported: true,
            targetedContributions: snapshot('occurrence-b'),
            targetedSurfaceMounts: [],
        });
        const { useMountedTargetedContributions } = await import('./mountedTargetedContributions');
        const scope = { machineId: 'machine-reload', serverId: 'server-1' };
        const revisionBefore = getMachineContributionRegistryProjectionRevision(scope);

        const rendered = await renderHook(() => useMountedTargetedContributions({
            machineId: 'machine-reload',
            serverId: 'server-1',
            pluginId: 'acme.triage',
            mountedOccurrenceId: 'occurrence-a',
            enabled: true,
        }));
        await flushHookEffects({ cycles: 3, turns: 2 });

        expect(rendered.getCurrent()).toMatchObject({
            phase: 'ready',
            targetedContributions: snapshot('occurrence-b'),
            failure: null,
        });
        // One invalidation for the (a → b) pair; the re-read it causes returns
        // the same tag and does not publish again.
        expect(getMachineContributionRegistryProjectionRevision(scope)).toBe(revisionBefore + 1);
        expect(targetedReadMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the classified failure reason and the last snapshot through a failed refresh', async () => {
        targetedReadMock
            .mockResolvedValueOnce({
                supported: true,
                targetedContributions: snapshot('occurrence-a'),
                targetedSurfaceMounts: [],
            })
            .mockResolvedValueOnce({ supported: false, reason: 'timeout' });
        const mod = await import('@/sync/ops/machineContributionRegistryProjection');
        const { useMountedTargetedContributions } = await import('./mountedTargetedContributions');

        const rendered = await renderHook(() => useMountedTargetedContributions({
            machineId: 'machine-timeout',
            serverId: 'server-1',
            pluginId: 'acme.triage',
            mountedOccurrenceId: 'occurrence-a',
            enabled: true,
        }));
        await flushHookEffects({ cycles: 2, turns: 2 });
        await act(async () => {
            mod.publishMachineContributionRegistryProjectionInvalidation({
                machineId: 'machine-timeout',
                serverId: 'server-1',
            });
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(rendered.getCurrent()).toMatchObject({
            phase: 'failed',
            failure: { reason: 'timeout' },
            targetedContributions: snapshot('occurrence-a'),
        });
    });
});
