import { describe, expect, it } from 'vitest';

import {
    buildActionExecutorContextForRpc,
    dispatchActionFromRpc,
    type RpcActionExecutor,
} from './_actionDispatchAdapter';

describe('RPC action dispatch adapter', () => {
    it('uses verified forwarded authority and refuses an unstamped forwarded caller', () => {
        expect(buildActionExecutorContextForRpc({ callerAuthority: 'present_user' }))
            .toMatchObject({ authority: 'present_user' });
        expect(buildActionExecutorContextForRpc({ callerAuthority: 'account_automation' }))
            .toMatchObject({ authority: 'account_automation' });
        expect(buildActionExecutorContextForRpc({}))
            .toMatchObject({ authority: 'account_automation' });
    });
    it('maps RPC invocation context to the accepted action executor surface', async () => {
        const calls: unknown[] = [];
        const executor: RpcActionExecutor = {
            execute: async (actionId, input, context) => {
                calls.push({ actionId, input, context });
                return { ok: true as const, result: { dispatched: true } };
            },
        };

        const result = await dispatchActionFromRpc({
            actionId: 'session.message.send',
            input: { sessionId: 'session-1', message: 'hello' },
            defaultSessionId: 'session-1',
            serverId: 'server-1',
            localActionContext: { surface: 'rpc', authority: 'present_user' },
            executor,
        });

        expect(result).toEqual({ ok: true, result: { dispatched: true } });
        expect(calls).toEqual([
            {
                actionId: 'session.message.send',
                input: { sessionId: 'session-1', message: 'hello' },
                context: {
                    defaultSessionId: 'session-1',
                    serverId: 'server-1',
                    surface: 'rpc',
                    authority: 'present_user',
                },
            },
        ]);
    });

    it('omits empty routing hints instead of passing placeholder values', () => {
        expect(buildActionExecutorContextForRpc({
            defaultSessionId: '  ',
            serverId: null,
    })).toEqual({ surface: 'rpc', authority: 'account_automation' });
    });

    it('preserves host-only active-turn authority for a local agent dispatch', () => {
        const causalPermissionAuthority = {
            kind: 'admittedSessionInputV1',
            admittedPermissionCeiling: 'default',
        };

        expect(buildActionExecutorContextForRpc({
            defaultSessionId: 'session-1',
            localActionContext: {
                surface: 'agent',
                callerPermissionMode: 'yolo',
                causalPermissionAuthority,
            },
        })).toEqual({
            defaultSessionId: 'session-1',
            surface: 'agent',
            authority: 'account_automation',
            callerPermissionMode: 'yolo',
            causalPermissionAuthority,
        });
    });

    it('defaults progress-only local context to automation authority', () => {
        expect(buildActionExecutorContextForRpc({
            defaultSessionId: 'session-1',
            localActionContext: { operationProgress: { update: () => undefined } },
        })).toMatchObject({ surface: 'rpc', authority: 'account_automation' });
    });
});
