import { NEW_SESSION_MODEL_PROBE_TIMEOUT_MS } from '@/components/sessions/new/modules/newSessionCapabilityProbeTimeoutMs';
import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installCapabilitiesOpsModuleMock } from '@/dev/testkit/mocks/capabilities';
import { resetDynamicModelProbeCacheForTests } from '@/sync/domains/models/dynamicModelProbeCache';
import { isModelSelectableForSession } from '@/sync/domains/models/modelOptions';
import { SessionModelDiscoveryDetail, type SessionModelDetailState } from './SessionModelDiscoveryDetail';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/sync/ops/capabilities', (importOriginal) => installCapabilitiesOpsModuleMock({ machineCapabilitiesInvoke: invoke })(importOriginal));

const discovery = {
    backendTarget: { kind: 'backend' as const, backendId: 'codex' },
    selectedMachineId: 'machine-session', capabilityServerId: 'server-session', cwd: '/session',
    probeContext: { cacheKeySuffixParts: ['session-runtime'], capabilityParams: { runtimeDescriptorV1: { v: 1, agentId: 'codex', agent: { backendMode: 'appServer' } }, profileId: 'profile-session' } },

};
const result = (id: string) => ({ supported: true, response: { ok: true, result: { runtimeDescriptorV1Accepted: true, availableModels: [{ id, name: id }], supportsFreeform: false } } });

describe('SessionModelDiscoveryDetail', () => {
    beforeEach(() => { invoke.mockReset(); resetDynamicModelProbeCacheForTests(); });

    it('discovers only while mounted, keeps rows during forced refresh and passes the same catalog to selection validation', async () => {
        let state: SessionModelDetailState | undefined;
        let finish: ((value: ReturnType<typeof result>) => void) | undefined;
        invoke.mockResolvedValueOnce(result('fresh-1')).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const detail = <SessionModelDiscoveryDetail agentId="codex" composerOptionsInput={null} discovery={() => discovery} renderDetail={(next) => { state = next; return null; }} />;
        const screen = await renderScreen(<React.Fragment />);
        expect(invoke).not.toHaveBeenCalled();
        await screen.update(detail);
        await flushHookEffects();
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(state?.modelOptions.some((option) => option.value === 'fresh-1')).toBe(true);
        expect(isModelSelectableForSession('codex', null, 'fresh-1', state?.modelOptionsContext)).toBe(true);
        await act(async () => { state?.probe?.onRefresh?.(); });
        expect(state?.modelOptions.some((option) => option.value === 'fresh-1')).toBe(true);
        expect(invoke.mock.calls[1]?.[1].params.bypassCache).toBe(true);
        await act(async () => { finish?.(result('fresh-2')); });
        expect(state?.modelOptions.some((option) => option.value === 'fresh-2')).toBe(true);
        expect(invoke.mock.calls[0]?.[0]).toBe('machine-session');
        expect(invoke.mock.calls[0]?.[1].params).toMatchObject({
            backendTarget: discovery.backendTarget, cwd: '/session',
            runtimeDescriptorV1: discovery.probeContext.capabilityParams.runtimeDescriptorV1, profileId: 'profile-session',
        });
        expect(invoke.mock.calls[0]?.[2]).toEqual({ serverId: 'server-session', timeoutMs: NEW_SESSION_MODEL_PROBE_TIMEOUT_MS });
        await screen.unmount();
    });
    it('stops transient retries when the detail closes and leaves read-only discovery idle', async () => {
        vi.useFakeTimers();
        try {
            invoke.mockResolvedValue({ supported: true, response: { ok: true, result: {
                runtimeDescriptorV1Accepted: true,
                availableModels: [{ id: 'temporary', name: 'Temporary' }], supportsFreeform: false,
                cacheable: false, source: 'static',
            } } });
            const screen = await renderScreen(<SessionModelDiscoveryDetail agentId="codex" composerOptionsInput={null}
                discovery={() => discovery} renderDetail={() => null} />);
            expect(invoke).toHaveBeenCalledTimes(1);
            await screen.update(<React.Fragment />);
            await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
            expect(invoke).toHaveBeenCalledTimes(1);
            await screen.update(<SessionModelDiscoveryDetail agentId="codex" composerOptionsInput={null}
                discovery={() => ({ ...discovery, enabled: false })} renderDetail={() => null} />);
            expect(invoke).toHaveBeenCalledTimes(1);
            await screen.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

});
