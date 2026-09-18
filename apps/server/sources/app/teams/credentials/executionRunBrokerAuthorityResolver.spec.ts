import { describe, expect, it, vi } from 'vitest';

import { createExecutionRunBrokerCurrentnessResolver } from './executionRunBrokerAuthorityResolver';

const request = {
    executionRunId: 'run-one',
    requestingAccountId: 'account-one',
    workerMachineId: 'machine-one',
    expectedIntent: 'voice_agent' as const,
    expectedOccurrenceId: 'occurrence-one',
};

describe('createExecutionRunBrokerCurrentnessResolver', () => {
    it('accepts only an exact nonce/Home/Account/Machine/Run/occurrence response', async () => {
        const forwardRpcForUser = vi.fn(async () => ({ ok: true as const, result: {
            status: 'current',
            requestNonce: '11111111-1111-4111-8111-111111111111',
            serverIdentityId: 'srv_home_one',
            requestingAccountId: request.requestingAccountId,
            workerMachineId: request.workerMachineId,
            executionRunId: request.executionRunId,
            occurrenceId: request.expectedOccurrenceId,
            parentSessionId: 'session-one',
            intent: 'voice_agent',
            runtimeState: 'active_turn',
            activeTurnId: 'voice-turn-1',
        } }));
        const resolve = createExecutionRunBrokerCurrentnessResolver({
            app: { forwardRpcForUser } as never,
            resolveServerIdentityId: async () => 'srv_home_one',
            createNonce: () => '11111111-1111-4111-8111-111111111111',
        });
        await expect(resolve(request)).resolves.toEqual({
            ok: true,
            parentSessionId: 'session-one',
            occurrenceId: 'occurrence-one',
            intent: 'voice_agent',
            runtimeState: 'active_turn',
            activeTurnId: 'voice-turn-1',
        });
        expect(forwardRpcForUser).toHaveBeenCalledWith({
            userId: request.requestingAccountId,
            method: 'machine-one:daemon.executionRuns.brokerAuthority.resolve.v1',
            params: expect.objectContaining({
                requestNonce: '11111111-1111-4111-8111-111111111111',
                serverIdentityId: 'srv_home_one',
                expectedIntent: 'voice_agent',
                expectedOccurrenceId: 'occurrence-one',
            }),
        });
    });

    it('leaves intent unrestricted when a generic broker caller omits expectedIntent', async () => {
        const { expectedIntent: _expectedIntent, ...genericRequest } = request;
        const forwardRpcForUser = vi.fn(async () => ({ ok: true as const, result: {
            status: 'current',
            requestNonce: '11111111-1111-4111-8111-111111111111',
            serverIdentityId: 'srv_home_one',
            requestingAccountId: request.requestingAccountId,
            workerMachineId: request.workerMachineId,
            executionRunId: request.executionRunId,
            occurrenceId: request.expectedOccurrenceId,
            parentSessionId: 'session-one',
            intent: 'delegate',
            runtimeState: 'active_turn',
        } }));
        const resolve = createExecutionRunBrokerCurrentnessResolver({
            app: { forwardRpcForUser } as never,
            resolveServerIdentityId: async () => 'srv_home_one',
            createNonce: () => '11111111-1111-4111-8111-111111111111',
        });

        await expect(resolve(genericRequest)).resolves.toMatchObject({ ok: true, intent: 'delegate' });
        expect(forwardRpcForUser).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.not.objectContaining({ expectedIntent: expect.anything() }),
        }));
    });

    it('preserves a current detached Execution Run without fabricating a parent Session', async () => {
        const resolve = createExecutionRunBrokerCurrentnessResolver({
            app: { forwardRpcForUser: async () => ({ ok: true, result: {
                status: 'current',
                requestNonce: '11111111-1111-4111-8111-111111111111',
                serverIdentityId: 'srv_home_one',
                requestingAccountId: request.requestingAccountId,
                workerMachineId: request.workerMachineId,
                executionRunId: request.executionRunId,
                occurrenceId: request.expectedOccurrenceId,
                parentSessionId: null,
                intent: 'voice_agent',
                runtimeState: 'active_turn',
                activeTurnId: 'detached-turn-1',
            } }) } as never,
            resolveServerIdentityId: async () => 'srv_home_one',
            createNonce: () => '11111111-1111-4111-8111-111111111111',
        });

        await expect(resolve(request)).resolves.toEqual({
            ok: true,
            parentSessionId: null,
            occurrenceId: 'occurrence-one',
            intent: 'voice_agent',
            runtimeState: 'active_turn',
            activeTurnId: 'detached-turn-1',
        });
    });

    it.each([
        ['nonce replay', { requestNonce: '22222222-2222-4222-8222-222222222222' }],
        ['Home substitution', { serverIdentityId: 'srv_other' }],
        ['Account substitution', { requestingAccountId: 'account-other' }],
        ['Machine substitution', { workerMachineId: 'machine-other' }],
        ['Run substitution', { executionRunId: 'run-other' }],
        ['occurrence substitution', { occurrenceId: 'occurrence-other' }],
        ['intent substitution', { intent: 'agent' }],
    ])('rejects %s', async (_label, substitution) => {
        const resolve = createExecutionRunBrokerCurrentnessResolver({
            app: { forwardRpcForUser: async () => ({ ok: true, result: {
                status: 'current',
                requestNonce: '11111111-1111-4111-8111-111111111111',
                serverIdentityId: 'srv_home_one',
                requestingAccountId: request.requestingAccountId,
                workerMachineId: request.workerMachineId,
                executionRunId: request.executionRunId,
                occurrenceId: request.expectedOccurrenceId,
                parentSessionId: 'session-one',
                intent: 'voice_agent',
                runtimeState: 'idle',
                ...substitution,
            } }) } as never,
            resolveServerIdentityId: async () => 'srv_home_one',
            createNonce: () => '11111111-1111-4111-8111-111111111111',
        });
        await expect(resolve(request)).resolves.toEqual({ ok: false, reasonCode: 'operation_not_current' });
    });

    it('distinguishes terminal, nonexistent, and unavailable daemon authority', async () => {
        const outcomes = [
            [{ ok: true, result: { status: 'not_current', requestNonce: '11111111-1111-4111-8111-111111111111', reason: 'terminal' } }, 'execution_run_terminal'],
            [{ ok: true, result: { status: 'not_current', requestNonce: '11111111-1111-4111-8111-111111111111', reason: 'not_found' } }, 'execution_run_not_found'],
            [{ ok: false }, 'execution_run_authority_unavailable'],
        ] as const;
        for (const [rpc, reasonCode] of outcomes) {
            const resolve = createExecutionRunBrokerCurrentnessResolver({
                app: { forwardRpcForUser: async () => rpc } as never,
                resolveServerIdentityId: async () => 'srv_home_one',
                createNonce: () => '11111111-1111-4111-8111-111111111111',
            });
            await expect(resolve(request)).resolves.toEqual({ ok: false, reasonCode });
        }
    });
});
