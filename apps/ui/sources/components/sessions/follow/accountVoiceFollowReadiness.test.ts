import { describe, expect, it } from 'vitest';
import { resolveAccountVoiceFollowReadiness } from './accountVoiceFollowReadiness';

describe('resolveAccountVoiceFollowReadiness', () => {
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
