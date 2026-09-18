import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { installNewSessionComponentsCommonModuleMocks } from '@/components/sessions/new/components/newSessionComponentsTestHelpers';
import type { useNewSessionScreenSimplePanelProps as UseNewSessionScreenSimplePanelProps } from './useNewSessionScreenSimplePanelProps';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installNewSessionComponentsCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

let useNewSessionScreenSimplePanelProps: typeof UseNewSessionScreenSimplePanelProps;

beforeAll(async () => {
    ({ useNewSessionScreenSimplePanelProps } = await import('./useNewSessionScreenSimplePanelProps'));
}, 240_000);

type Params = Parameters<typeof UseNewSessionScreenSimplePanelProps>[0];

function buildParams(
    machineAndResume: Partial<Params['machineAndResume']>,
): Params {
    return {
        layout: {} as Params['layout'],
        creation: {} as Params['creation'],
        agent: { selectedBackendTargetKey: 'agent' } as Params['agent'],
        model: { modelOptionsProbeState: { phase: 'idle', onRefresh: vi.fn() } } as unknown as Params['model'],
        acp: {
            acpSessionModeProbeState: { phase: 'idle', onRefresh: vi.fn() },
            acpConfigOptionsProbeState: { phase: 'idle', onRefresh: vi.fn() },
        } as unknown as Params['acp'],
        machineAndResume: {
            destination: { machineGroups: [{ serverId: 'home-a', serverName: 'Home A' }], poolGroups: [] },
            ...machineAndResume,
        } as Params['machineAndResume'],
        profile: { selectedMachineId: null } as Params['profile'],
        targetServerId: 'home-a',
        attachmentFlowId: 'flow-a',
    } as Params;
}

describe('useNewSessionScreenSimplePanelProps destination naming', () => {
    it('names a committed Temporary computer rather than asking for a machine that will never exist', async () => {
        const rendered = await renderHook(() => useNewSessionScreenSimplePanelProps(buildParams({
            executionTarget: {
                kind: 'temporary_computer',
                serverId: 'home-a',
                artifactTarget: 'windows-x64',
                workspace: { kind: 'choose_on_endpoint' },
            },
        })));

        // The chip falls back to "Select machine" whenever this is undefined, which
        // is exactly the lie a chosen Temporary computer must not tell.
        expect(rendered.getCurrent().machineName).toBe('newSession.temporaryComputer.destination.windows');
        await rendered.unmount();
    });

    it('keeps the destination readable for a platform this build cannot recognize', async () => {
        const rendered = await renderHook(() => useNewSessionScreenSimplePanelProps(buildParams({
            executionTarget: {
                kind: 'temporary_computer',
                serverId: 'home-a',
                artifactTarget: 'plan9-riscv64' as never,
                workspace: { kind: 'endpoint_home' },
            },
        })));

        expect(rendered.getCurrent().machineName).toBe('newSession.temporaryComputer.title');
        await rendered.unmount();
    });

    it('leaves an exact-Machine destination to the Machine naming owner', async () => {
        const rendered = await renderHook(() => useNewSessionScreenSimplePanelProps(buildParams({
            executionTarget: { kind: 'machine', target: { serverId: 'home-a', machineId: 'machine-a' } },
            machineDisplayName: 'Mac Studio',
            machineHost: 'studio.local',
        })));

        expect(rendered.getCurrent().machineName).toBe('Mac Studio');
        await rendered.unmount();
    });
});
