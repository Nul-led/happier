import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverMachineModels } from './modelDiscovery';
import {
    DYNAMIC_MODEL_PROBE_SUCCESS_TTL_MS,
    readDynamicModelProbeCache,
    resetDynamicModelProbeCacheForTests,
    writeDynamicModelProbeCacheSuccess,
} from '@/sync/domains/models/dynamicModelProbeCache';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/sync/ops/capabilities', () => ({ machineCapabilitiesInvoke: invoke }));

const request = {
    cacheKey: 'exact-session-runtime',
    agentType: 'codex',
    machineId: 'machine',
    backendTarget: { kind: 'backend', backendId: 'codex' } as const,
    capabilityParams: {
        runtimeDescriptorV1: { v: 1, agentId: 'codex', agent: { backendMode: 'appServer', providerSessionId: 'thread' } },
    },
};
const availableModels = [{ id: 'account-default', name: 'Account default' }];
const response = (ack?: boolean) => ({
    supported: true,
    response: { ok: true, result: {
        availableModels, supportsFreeform: false,
        ...(ack === undefined ? {} : { runtimeDescriptorV1Accepted: ack }),
    } },
});

describe('exact runtime model discovery acknowledgement', () => {
    beforeEach(() => {
        invoke.mockReset();
        resetDynamicModelProbeCacheForTests();
    });

    it.each([undefined, false])('rejects unacknowledged runtime results (%s) without promoting rows or renewing last-good age', async (ack) => {
        const observedAt = Date.now() - DYNAMIC_MODEL_PROBE_SUCCESS_TTL_MS - 1;
        const previous = { availableModels: [{ id: 'session-model', name: 'Session model' }], supportsFreeform: false };
        writeDynamicModelProbeCacheSuccess(request.cacheKey, previous, observedAt);
        invoke.mockResolvedValue(response(ack));
        const retained = await discoverMachineModels(request);
        expect(retained).toMatchObject({ kind: 'success', value: previous, updatedAt: observedAt, errorUpdatedAt: expect.any(Number) });
        expect(await discoverMachineModels({ ...request, cacheKey: 'cold-runtime' })).toMatchObject({ kind: 'error' });
        expect(readDynamicModelProbeCache('cold-runtime')).not.toHaveProperty('value');
    });

    it('promotes an acknowledged exact-runtime response and preserves requests without a descriptor', async () => {
        invoke.mockResolvedValue(response(true));
        expect(await discoverMachineModels(request)).toMatchObject({ kind: 'success', value: { availableModels } });
        invoke.mockResolvedValue(response());
        expect(await discoverMachineModels({ ...request, cacheKey: 'ordinary-discovery', capabilityParams: {} })).toMatchObject({
            kind: 'success', value: { availableModels },
        });
    });
});
