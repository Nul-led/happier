import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { QualifiedConnectedAccountGroupV4Schema } from '@happier-dev/protocol/connect/qualified-connected-account-projections';
import { ConnectedServiceAuthGroupPolicyV1Schema } from '@happier-dev/protocol/connect/connected-service-schemas';
import { useConnectedServiceGroupsRefreshSignal } from '@/sync/domains/connectedServices/connectedServiceGroupsRefreshSignal';
import { createUiConnectedServiceAction } from './connectedServiceActionDeps';
import type { LazyActionAccountContext } from './actionAccountContext';
import * as machineRpc from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

it('admits quota refresh through the exact Home machine before requesting the selected account refresh', async () => {
    const service = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
    const accountRef = { service, accountId: 'work-account' };
    const requests: unknown[] = [];
    let groupRevision = 0;
    function GroupProbe() { groupRevision = useConnectedServiceGroupsRefreshSignal(); return null; }
    const screen = await renderScreen(React.createElement(GroupProbe));
    const beforeRefresh = groupRevision;
    const rpc = vi.spyOn(machineRpc, 'machineRpcWithServerScope').mockResolvedValue({
        status: 'described', service,
        descriptor: { id: 'openai-codex', title: 'Codex', authentication: { defaultModeId: 'oauth', modes: [{ id: 'oauth', kind: 'oauthAuthorizationCode', pkce: 'required', outcomeReconciliation: 'none' }] } },
        occurrenceId: 'occurrence-1', sourceCustody: { kind: 'bundled_first_party', packagedRuntime: { kind: 'cli_version_root', versionRootId: 'cli-1' } },
        accounts: [], operationTransport: { kind: 'v4' },
    });
    // Only HTTP and machine RPC transports are substituted; service admission remains real.
    const account = { serverId: 'work-home', credentials: { token: 'boundary-token' }, assertCurrent() {},
        async request(path: string, init: RequestInit) { requests.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ success: true }), { status: 200 }); },
    } as unknown as LazyActionAccountContext;
    try {
        const action = createUiConnectedServiceAction(account);
        const args = { actionId: 'connectedServices.quota.refresh' as const, input: { account: accountRef, machineId: 'work-machine' }, context: { surface: 'ui' as const, authority: 'present_user' as const } };
        await act(async () => { expect(await action(args)).toEqual({ applied: true }); });
        expect(groupRevision).toBe(beforeRefresh);
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'work-home', machineId: 'work-machine',
            payload: { v: 1, machineId: 'work-machine', command: { operation: 'describeService', service, requiredOperation: 'quota_refresh' } } }));
        expect(requests).toEqual([{ path: '/v4/connect/qualified/quotas/refresh', method: 'POST', body: { ref: accountRef } }]);
        rpc.mockResolvedValue({ status: 'unavailable', code: 'quota_refresh_unavailable' });
        expect(await action(args)).toMatchObject({ ok: false, errorCode: 'quota_refresh_unavailable' });
        expect(requests).toHaveLength(1);
    } finally { rpc.mockRestore(); await screen.unmount(); }
});

it('publishes a successful Action pool mutation to the real mounted group refresh subscription', async () => {
    let observed = 0;
    function Probe() { observed = useConnectedServiceGroupsRefreshSignal(); return null; }
    const screen = await renderScreen(React.createElement(Probe));
    const before = observed;
    const service = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
    const group = QualifiedConnectedAccountGroupV4Schema.parse({ v: 1, ref: { service, groupId: 'work' }, incarnation: 'life', displayName: null,
        policy: ConnectedServiceAuthGroupPolicyV1Schema.parse({}), activeConnectedAccountId: 'personal', generation: 2, runtimeStateRevision: 1,
        state: {}, createdAt: 0, updatedAt: 0, members: [],
    });
    // Only the authenticated HTTP transport and credential lifetime are substituted.
    const account = {
        credentials: { token: 'transport-boundary' }, assertCurrent() {},
        async request() { return new Response(JSON.stringify({ group }), { status: 200 }); },
    } as unknown as LazyActionAccountContext;
    await act(async () => {
        expect(await createUiConnectedServiceAction(account)({ actionId: 'connectedServices.pools.switchNow',
            input: { group: group.ref, connectedAccountId: 'personal', expectedGeneration: 1 },
            context: { surface: 'ui', authority: 'present_user' },
        })).toEqual({ applied: true });
    });
    expect(observed).toBeGreaterThan(before);
    await screen.unmount();
});
