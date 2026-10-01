import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';

const observed = vi.hoisted(() => ({
    sessionArgs: [] as unknown[][],
    session: { id: 'session-1', serverId: 'home-b', encryptionMode: 'plain' as string } as { id: string; serverId: string; encryptionMode: string } | undefined,
    encryption: { getSessionEncryption: () => null } as { getSessionEncryption: (sessionId: string) => unknown } | null,
}));

vi.mock('@/sync/domains/state/storage', () => ({
    storage: (selector: (state: Record<string, never>) => unknown) => selector({}),
    useActiveServerAccountScope: () => ({ serverId: 'home-b', accountId: 'account-b' }),
    useSession: (...args: unknown[]) => {
        observed.sessionArgs.push(args);
        return observed.session;
    },
    useSetting: () => null,
}));
vi.mock('@/sync/sync', () => ({
    sync: observed,
}));
vi.mock('@/sync/store/domains/machines/resolveMachinesForActiveServerFromState', () => ({
    resolveMachineForActiveServerFromState: () => ({
        operationProtocolCapabilities: { sessionFollow: { contextV1: true } },
    }),
}));
vi.mock('@/voice/credentials/useExecutionMachinePresentation', () => ({
    useVoiceExecutionMachinePresentation: () => ({ machineId: 'machine-1' }),
}));
vi.mock('@/voice/settings/resolveVoiceProviderId', () => ({
    resolveVoiceProviderIdForBindingScope: () => 'provider-1',
}));
vi.mock('@/voice/session/voiceAdapterRegistry', () => ({
    getVoiceAdapterRegistry: () => ({ subscribe: () => () => undefined }),
    resolveVoiceAdapterContextChannel: () => ({ hostAuthoredContext: 'session_context' }),
}));
vi.mock('@/voice/session/voiceSession', () => ({
    useVoiceSessionSnapshot: () => ({ status: 'connected', adapterId: 'provider-1' }),
}));
vi.mock('@/sync/domains/settings/voiceSettings', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/settings/voiceSettings')>()),
    voiceSettingsParse: () => ({}),
}));
import { resolveAccountVoiceFollowReadiness } from './accountVoiceFollowReadiness';

describe('resolveAccountVoiceFollowReadiness', () => {
    beforeEach(() => {
        observed.sessionArgs.length = 0;
        observed.session = { id: 'session-1', serverId: 'home-b', encryptionMode: 'plain' };
        observed.encryption = { getSessionEncryption: () => null };
    });

    afterEach(() => standardCleanup());

    it('reads the source Session through the exact Home scope', async () => {
        const { useAccountVoiceFollowReadiness } = await import('./useAccountVoiceFollowReadiness');
        const hook = await renderHook(() => useAccountVoiceFollowReadiness({
            sessionId: 'session-1',
            serverId: 'home-b',
            initialSnapshotPending: false,
        }));

        expect(hook.getCurrent()).toBe('eligible');
        expect(observed.sessionArgs).toContainEqual(['session-1', 'home-b']);
    });

    it('does not treat an encrypted source as ready when the Account encryption authority is absent', async () => {
        observed.session = { id: 'session-1', serverId: 'home-b', encryptionMode: 'e2ee' };
        observed.encryption = null;
        const { useAccountVoiceFollowReadiness } = await import('./useAccountVoiceFollowReadiness');
        const hook = await renderHook(() => useAccountVoiceFollowReadiness({
            sessionId: 'session-1',
            serverId: 'home-b',
            initialSnapshotPending: false,
        }));

        expect(hook.getCurrent()).toBe('waiting_encrypted');
    });

    it('does not report missing encryption while the exact Home Session is loading', async () => {
        observed.session = undefined;
        const { useAccountVoiceFollowReadiness } = await import('./useAccountVoiceFollowReadiness');
        const hook = await renderHook(() => useAccountVoiceFollowReadiness({
            sessionId: 'session-1',
            serverId: 'home-b',
            initialSnapshotPending: false,
        }));

        expect(hook.getCurrent()).toBe('waiting_for_runtime');
    });

    const supportedMachine = { operationProtocolCapabilities: { sessionFollow: { contextV1: true } } };
    it('derives current runtime, capability, encryption, pending, and eligible states', () => {
        const base = { adapterPresent: true, scopeCurrent: true } as const;
        expect(resolveAccountVoiceFollowReadiness({ ...base, scopeCurrent: false, contextScope: 'session_context', machine: supportedMachine, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('waiting_for_runtime');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'session_context', machine: null, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('waiting_for_runtime');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'session_context', machine: { operationProtocolCapabilities: {} }, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('runtime_unsupported');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'current_ui_only', machine: supportedMachine, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('provider_withheld');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'current_ui_only', machine: null, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('provider_withheld');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'session_context', machine: supportedMachine, sourceEncrypted: true, sourceKeyReady: false, initialSnapshotPending: false })).toBe('waiting_encrypted');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'session_context', machine: supportedMachine, sourceEncrypted: true, sourceKeyReady: true, initialSnapshotPending: true })).toBe('pending');
        expect(resolveAccountVoiceFollowReadiness({ ...base, contextScope: 'session_context', machine: supportedMachine, sourceEncrypted: false, sourceKeyReady: true, initialSnapshotPending: false })).toBe('eligible');
    });
});
