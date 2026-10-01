import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { QualifiedConnectedAccountGroupV4Schema } from '@happier-dev/protocol/connect/qualified-connected-account-projections';
import { ConnectedServiceAuthGroupPolicyV1Schema } from '@happier-dev/protocol/connect/connected-service-schemas';
import { useConnectedServiceGroupsRefreshSignal } from '@/sync/domains/connectedServices/connectedServiceGroupsRefreshSignal';
import { createUiConnectedServiceAction } from './connectedServiceActionDeps';
import type { LazyActionAccountContext } from './actionAccountContext';

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
