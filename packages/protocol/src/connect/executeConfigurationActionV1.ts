import { accountSettingsParse } from '../account/settings/accountSettings.js';
import { writeAgentDefaultChoice, type AgentDefaultChoiceAgent } from './agentDefaultChoices.js';
import { readBuiltInLegacyConnectedServiceIdForQualifiedService } from './connectedServiceBindings.js';
import { updateQualifiedConnectedAccountLabel } from './connectedServiceProfilePreferences.js';
import { encodeQualifiedConnectedAccountV4StructuredQueryValue } from './qualifiedConnectedAccountsV4QueryCodec.js';
import { QualifiedConnectedAccountGroupRefSchema, QualifiedConnectedAccountGroupResponseV4Schema, QualifiedConnectedAccountGroupMemberMutationV4Schema, sameQualifiedConnectedAccountGroupRef, type QualifiedConnectedAccountGroupRef } from './qualifiedConnectedAccountsV4.js';
import {
  CONNECTED_SERVICE_CONFIGURATION_ACTION_INPUT_SCHEMAS_V1 as inputs,
  reorderConnectedServicePoolMembersV1,
  type ConnectedServiceConfigurationActionIdV1,
} from './configurationActionsV1.js';

type QuotaResetInput = ReturnType<(typeof inputs)['connectedServices.quota.reset']['parse']>;
export type ConnectedServiceConfigurationActionHostV1 = Readonly<{
  /** Authenticated transport for the invocation's exact Home. */
  request(input: Readonly<{ method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }>): Promise<unknown>;
  mutateSettings(mutate: (raw: Readonly<Record<string, unknown>>) => Record<string, unknown>): Promise<void>;
  resolveAgent(agentId: string, machineId?: string): Promise<AgentDefaultChoiceAgent | null>;
  resetQuota(input: QuotaResetInput): Promise<unknown>;
  setIdentityPrivacy?: (hidden: boolean) => void;
  assertCurrent(): void;
}>;

function readGroup(value: unknown, expected: QualifiedConnectedAccountGroupRef) {
  const { group } = QualifiedConnectedAccountGroupResponseV4Schema.parse(value);
  if (!sameQualifiedConnectedAccountGroupRef(group.ref, expected)) {
    throw Object.assign(new Error('qualified_connected_accounts_inconsistent_peer'), { code: 'qualified_connected_accounts_inconsistent_peer' });
  }
  return group;
}

/** Thin Action adapter over the existing settings writers, pool endpoints and reset RPC. */
export async function executeConnectedServiceConfigurationActionV1(
  host: ConnectedServiceConfigurationActionHostV1,
  actionId: ConnectedServiceConfigurationActionIdV1,
  input: unknown,
): Promise<unknown> {
  host.assertCurrent();
  switch (actionId) {
    case 'connectedServices.accounts.rename': {
      const { account, label } = inputs[actionId].parse(input);
      await host.mutateSettings((raw) => {
        host.assertCurrent();
        const settings = accountSettingsParse(raw);
        return { ...raw, connectedServicesProfileLabelByKey: updateQualifiedConnectedAccountLabel({
          service: account.service,
          legacyServiceId: readBuiltInLegacyConnectedServiceIdForQualifiedService(account.service),
          accountId: account.accountId, label, labelsByKey: settings.connectedServicesProfileLabelByKey,
        }) };
      });
      break;
    }
    case 'connectedServices.pools.switchNow': {
      const body = inputs[actionId].parse(input);
      readGroup(await host.request({ method: 'POST', path: '/v4/connect/qualified/group/active-account', body }), body.group);
      break;
    }
    case 'connectedServices.pools.reorder': {
      const args = inputs[actionId].parse(input);
      const encoded = encodeURIComponent(encodeQualifiedConnectedAccountV4StructuredQueryValue(QualifiedConnectedAccountGroupRefSchema, args.group));
      const group = readGroup(await host.request({ method: 'GET', path: `/v4/connect/qualified/group?group=${encoded}` }), args.group);
      await reorderConnectedServicePoolMembersV1({ group, accountIds: args.accountIds,
        members: (current) => current.members.map((member) => ({ accountId: member.connectedAccountId, priority: member.priority })),
        patch: async (current, connectedAccountId, priority) => {
          host.assertCurrent();
          const body = QualifiedConnectedAccountGroupMemberMutationV4Schema.parse({ group: current.ref, connectedAccountId, priority,
            expectedGeneration: current.generation, expectedIncarnation: current.incarnation, expectedRuntimeStateRevision: current.runtimeStateRevision });
          return readGroup(await host.request({ method: 'PATCH', path: '/v4/connect/qualified/group/member', body }), args.group);
        },
      });
      break;
    }
    case 'connectedServices.pools.default.set': {
      const args = inputs[actionId].parse(input);
      const agent = await host.resolveAgent(args.agentId, args.machineId);
      host.assertCurrent();
      if (!agent) return { ok: false, errorCode: 'unknown_agent', error: 'unknown_agent' };
      await host.mutateSettings((raw) => {
        host.assertCurrent();
        const written = writeAgentDefaultChoice({ agents: [agent], agentId: args.agentId, makeDefault: args.makeDefault,
          settings: accountSettingsParse(raw), target: { kind: 'group', service: args.group.service, groupId: args.group.groupId } });
        if (!written) throw Object.assign(new Error('agent_connected_service_unavailable'), { code: 'agent_connected_service_unavailable' });
        return { ...raw, ...written };
      });
      break;
    }
    case 'connectedServices.quota.reset':
      return await host.resetQuota(inputs[actionId].parse(input));
    case 'connectedServices.identityPrivacy.set': {
      if (!host.setIdentityPrivacy) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' };
      host.setIdentityPrivacy(inputs[actionId].parse(input).hidden);
      break;
    }
  }
  host.assertCurrent();
  return { applied: true };
}
