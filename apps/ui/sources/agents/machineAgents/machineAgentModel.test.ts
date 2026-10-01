import { describe, expect, it } from 'vitest';
import { projectMachineAgent, reconcileMachineAgents, resolveMachineAgentSignIn } from './machineAgentModel';

describe('machine agent projection', () => {
    it('a healthy accepted connected account satisfies sign-in when the native CLI is signed out', () => {
        const connectedServices = [{ serviceId: 'chatgpt', title: 'ChatGPT', connected: true, healthy: true, profileLabel: 'Work' }];
        expect(resolveMachineAgentSignIn({ native: { status: 'signedOut', loginSupport: 'login_terminal' }, connectedServices })).toMatchObject({
            status: 'signedIn', via: { kind: 'connected', serviceId: 'chatgpt', title: 'ChatGPT', profileLabel: 'Work' },
        });
        expect(resolveMachineAgentSignIn({ native: { status: 'signedOut', loginSupport: 'login_terminal' }, connectedServices: [{ ...connectedServices[0], healthy: false }] }).status).toBe('signedOut');
    });
    it('preserves individual agent references and suppresses a no-op list update', () => {
        const initial = ['claude', 'codex'].map((agentId) => projectMachineAgent({ agentId, title: agentId, facts: null, checking: true, stale: false, connectedServices: [], job: null }));
        const same = initial.map((agent) => ({ ...agent }));
        expect(reconcileMachineAgents(initial, same)).toBe(initial);
        const changed = reconcileMachineAgents(initial, [same[0], { ...same[1], stale: true }]);
        expect(changed[0]).toBe(initial[0]);
        expect(changed[1]).not.toBe(initial[1]);
    });
});
