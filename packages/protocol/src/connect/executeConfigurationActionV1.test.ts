import { describe, expect, it } from 'vitest';
import { executeConnectedServiceConfigurationActionV1, type ConnectedServiceConfigurationActionHostV1 } from './executeConfigurationActionV1.js';
import { reorderConnectedServicePoolMembersV1 } from './configurationActionsV1.js';
import { buildAgentDefaultChoices } from './agentDefaultChoices.js';
import { resolveQualifiedConnectedAccountLabel } from './connectedServiceProfilePreferences.js';
import { accountSettingsParse } from '../account/settings/accountSettings.js';
import { QualifiedConnectedAccountGroupV4Schema } from './qualifiedConnectedAccountsV4.js';
import { ConnectedServiceAuthGroupPolicyV1Schema } from './connectedServiceSchemas.js';
import { createActionExecutor, type ActionExecutorDeps } from '../actions/actionExecutor.js';

const service = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
const agent = { agentId: 'codex', title: 'Codex', identity: { pluginId: 'happier.agent.codex', localId: 'codex' }, connectedAccounts: [{ purpose: 'model', service }] };
const target = { kind: 'group' as const, service, groupId: 'work' };

describe('connected-service configuration Action owner', () => {
    it('lets an agent refresh the exact qualified account and rejects an unacknowledged refresh', async () => {
        const account = { service, accountId: 'work-account' };
        const requests: unknown[] = [];
        let response: unknown = { success: true };
        const describedAdmission = { status: 'described', service,
            descriptor: { id: 'openai-codex', title: 'Codex', authentication: { defaultModeId: 'oauth', modes: [{ id: 'oauth', kind: 'oauthAuthorizationCode', pkce: 'required', outcomeReconciliation: 'none' }] } },
            occurrenceId: 'occurrence-1', sourceCustody: { kind: 'bundled_first_party', packagedRuntime: { kind: 'cli_version_root', versionRootId: 'cli-1' } },
            accounts: [], operationTransport: { kind: 'v4' },
        };
        let admission: unknown = describedAdmission;
        const host: ConnectedServiceConfigurationActionHostV1 = {
            assertCurrent() {},
            async request(request) { requests.push(request); return response; },
            async mutateSettings() { throw new Error('unexpected_settings'); },
            async resolveAgent() { throw new Error('unexpected_catalog'); },
            async resetQuota() { throw new Error('unexpected_reset'); },
            async controlCommand(machineId, command) { requests.push({ machineId, command }); return admission; },
        };
        // HTTP is substituted; Action admission, input parsing and execution remain real.
        const executor = createActionExecutor({ connectedServiceAction: ({ actionId, input }) => executeConnectedServiceConfigurationActionV1(host, actionId, input) } as unknown as ActionExecutorDeps);
        const context = { surface: 'agent' as const, authority: 'account_automation' as const, actionCaller: { kind: 'host' as const } };
        const actionId = 'connectedServices.quota.refresh';
        const input = { account, machineId: 'machine-work' };
        expect(await executor.execute(actionId, input, context)).toEqual({ ok: true, result: { applied: true } });
        expect(requests).toEqual([{ machineId: 'machine-work', command: { operation: 'describeService', service, requiredOperation: 'quota_refresh' } },
            { method: 'POST', path: '/v4/connect/qualified/quotas/refresh', body: { ref: account } }]);
        response = { success: false };
        expect(await executor.execute(actionId, input, context)).toMatchObject({ ok: false });
        admission = { status: 'unavailable', code: 'quota_refresh_unavailable' };
        response = { success: true };
        expect(await executor.execute(actionId, input, context)).toMatchObject({ ok: false, errorCode: 'quota_refresh_unavailable' });
        for (const invalidAdmission of [
            { ...describedAdmission, service: { ...service, pluginId: 'other.plugin' } },
            { ...describedAdmission, operationTransport: { kind: 'legacy', peerClass: 'revisioned_v2_v3', serviceId: 'openai-codex' } },
            { ...describedAdmission, operationTransport: undefined },
        ]) {
            admission = invalidAdmission;
            expect(await executor.execute(actionId, input, context)).toMatchObject({ ok: false, errorCode: 'connected_account_v4_operation_unsupported' });
        }
        expect(requests.filter((request) => typeof request === 'object' && request !== null && 'method' in request)).toHaveLength(2);
        const beforeInvalid = requests.length;
        expect(await executor.execute(actionId, { ...input, accountId: 'foreign' }, context)).toMatchObject({ ok: false });
        expect(requests).toHaveLength(beforeInvalid);
    });
    it('refuses a switch response for another pool rather than reporting success', async () => {
        const group = QualifiedConnectedAccountGroupV4Schema.parse({ v: 1, ref: { service, groupId: 'foreign' }, incarnation: 'life', displayName: null,
            policy: ConnectedServiceAuthGroupPolicyV1Schema.parse({}), activeConnectedAccountId: null, generation: 1, runtimeStateRevision: 0,
            state: {}, createdAt: 0, updatedAt: 0, members: [],
        });
        const host: ConnectedServiceConfigurationActionHostV1 = {
            assertCurrent() {}, async request() { return { group }; },
            async mutateSettings() { throw new Error('unexpected_settings'); }, async resolveAgent() { return null; }, async resetQuota() { throw new Error('unexpected_reset'); },
        };
        await expect(executeConnectedServiceConfigurationActionV1(host, 'connectedServices.pools.switchNow', {
            group: { service, groupId: 'work' }, connectedAccountId: 'personal', expectedGeneration: 1,
        })).rejects.toMatchObject({ code: 'qualified_connected_accounts_inconsistent_peer' });
    });
    it('renames predecessor labels without changing unrelated settings, writes defaults through purpose bindings, and keeps privacy local', async () => {
        let settings: Record<string, unknown> = { other: { retained: true }, connectedServicesProfileLabelByKey: { 'openai-codex/personal': 'Old' } };
        let hidden = false;
        const host: ConnectedServiceConfigurationActionHostV1 = {
            assertCurrent() {},
            async request() { throw new Error('unexpected_network'); },
            async mutateSettings(mutate) { settings = mutate(settings); },
            async resolveAgent() { return agent; },
            async resetQuota() { throw new Error('unexpected_reset'); },
            setIdentityPrivacy(value) { hidden = value; },
        };
        // The settings/network/device boundary is injected; admission, schema parsing and domain writers remain real.
        const executor = createActionExecutor({ connectedServiceAction: ({ actionId, input }) => executeConnectedServiceConfigurationActionV1(host, actionId, input) } as unknown as ActionExecutorDeps);
        const context = { surface: 'ui' as const, authority: 'present_user' as const, actionCaller: { kind: 'host' as const } };
        expect(await executor.execute('connectedServices.accounts.rename', { account: { service, accountId: 'personal' }, label: ' Team ' }, context)).toEqual({ ok: true, result: { applied: true } });
        const labels = settings.connectedServicesProfileLabelByKey as Record<string, string>;
        expect(resolveQualifiedConnectedAccountLabel({ service, legacyServiceId: 'openai-codex', accountId: 'personal', labelsByKey: labels })).toBe('Team');
        expect(labels['openai-codex/personal']).toBeUndefined();
        expect(settings.other).toEqual({ retained: true });
        await executeConnectedServiceConfigurationActionV1(host, 'connectedServices.pools.default.set', { group: { service, groupId: 'work' }, agentId: 'codex', makeDefault: true });
        expect(buildAgentDefaultChoices({ agents: [agent], settings: accountSettingsParse(settings), target })[0]?.isDefault).toBe(true);
        await executeConnectedServiceConfigurationActionV1(host, 'connectedServices.pools.default.set', { group: { service, groupId: 'work' }, agentId: 'codex', makeDefault: false });
        expect(buildAgentDefaultChoices({ agents: [agent], settings: accountSettingsParse(settings), target })[0]?.isDefault).toBe(false);
        const beforePrivacy = settings;
        expect(await executor.execute('connectedServices.identityPrivacy.set', { hidden: true }, context)).toEqual({ ok: true, result: { applied: true } });
        expect(hidden).toBe(true);
        expect(settings).toBe(beforePrivacy);
    });

    it('rejects incomplete or duplicate member orders before writes, chains current revision responses, and stops on rejection', async () => {
        const group = { generation: 1, members: [{ accountId: 'a', priority: 100 }, { accountId: 'b', priority: 200 }] };
        const writes: number[] = [];
        const members = (current: typeof group) => current.members;
        const patch = async (current: typeof group, accountId: string, priority: number) => {
            writes.push(current.generation);
            return { generation: current.generation + 1, members: current.members.map((member) => member.accountId === accountId ? { accountId, priority } : member) };
        };
        for (const accountIds of [['a'], ['a', 'a'], ['a', 'foreign']]) {
            await expect(reorderConnectedServicePoolMembersV1({ group, accountIds, members, patch })).rejects.toMatchObject({ code: 'invalid_pool_member_order' });
        }
        expect(writes).toEqual([]);
        const updated = await reorderConnectedServicePoolMembersV1({ group, accountIds: ['b', 'a'], members, patch });
        expect(writes).toEqual([1, 2]);
        expect(updated?.members).toEqual([{ accountId: 'a', priority: 200 }, { accountId: 'b', priority: 100 }]);
        await expect(reorderConnectedServicePoolMembersV1({ group, accountIds: ['b', 'a'], members, patch: async () => null })).resolves.toBeNull();
    });
});
