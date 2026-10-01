import { z } from 'zod';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { QualifiedConnectedAccountRefSchema } from './qualifiedConnectedAccountPersistence.js';
import { QualifiedConnectedAccountGroupRefSchema, QualifiedConnectedAccountGroupActiveAccountV4Schema } from './qualifiedConnectedAccountsV4.js';
import { ConnectedServiceIdSchema, ConnectedServiceProfileIdSchema } from './connectedServiceBindings.js';
import { ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema } from '../sessions/work/state/sessionWorkStateRpc.js';

export const CONNECTED_SERVICE_CONFIGURATION_ACTION_IDS_V1 = [
  'connectedServices.accounts.rename',
  'connectedServices.pools.switchNow',
  'connectedServices.pools.reorder',
  'connectedServices.pools.default.set',
  'connectedServices.quota.reset',
  'connectedServices.identityPrivacy.set',
] as const;
export const ConnectedServiceConfigurationActionIdV1Schema = z.enum(CONNECTED_SERVICE_CONFIGURATION_ACTION_IDS_V1);
export type ConnectedServiceConfigurationActionIdV1 = z.infer<typeof ConnectedServiceConfigurationActionIdV1Schema>;

const Success = z.object({ applied: z.literal(true) }).strict();
export const CONNECTED_SERVICE_CONFIGURATION_ACTION_INPUT_SCHEMAS_V1 = {
  'connectedServices.accounts.rename': z.object({ account: asProtocolZod(QualifiedConnectedAccountRefSchema), label: z.string().nullable() }).strict(),
  'connectedServices.pools.switchNow': QualifiedConnectedAccountGroupActiveAccountV4Schema,
  'connectedServices.pools.reorder': z.object({ group: QualifiedConnectedAccountGroupRefSchema, accountIds: z.array(z.string().min(1)) }).strict(),
  'connectedServices.pools.default.set': z.object({ group: QualifiedConnectedAccountGroupRefSchema, agentId: z.string().trim().min(1), makeDefault: z.boolean(), machineId: z.string().trim().min(1).optional() }).strict(),
  'connectedServices.quota.reset': z.object({ machineId: z.string().trim().min(1), serviceId: ConnectedServiceIdSchema, profileId: ConnectedServiceProfileIdSchema, providerCreditId: z.string().trim().min(1).optional(), sourceSnapshotFetchedAtMs: z.number().int().nonnegative().nullable().optional() }).strict(),
  'connectedServices.identityPrivacy.set': z.object({ hidden: z.boolean() }).strict(),
} as const;
export const CONNECTED_SERVICE_CONFIGURATION_ACTION_OUTPUT_SCHEMAS_V1 = {
  'connectedServices.accounts.rename': Success,
  'connectedServices.pools.switchNow': Success,
  'connectedServices.pools.reorder': Success,
  'connectedServices.pools.default.set': Success,
  'connectedServices.quota.reset': ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema,
  'connectedServices.identityPrivacy.set': Success,
} as const;

/** The member ladder shared by add, UI drag/keyboard reorder and Action reorder. */
export const CONNECTED_SERVICE_POOL_MEMBER_PRIORITY_STEP = 100;

export async function reorderConnectedServicePoolMembersV1<TGroup>(input: Readonly<{
  group: TGroup;
  accountIds: readonly string[];
  members(group: TGroup): readonly Readonly<{ accountId: string; priority: number }>[];
  patch(group: TGroup, accountId: string, priority: number): Promise<TGroup | null>;
}>): Promise<TGroup | null> {
  const members = input.members(input.group);
  const ids = new Set(input.accountIds);
  if (ids.size !== input.accountIds.length || ids.size !== members.length || members.some((member) => !ids.has(member.accountId))) {
    throw Object.assign(new Error('invalid_pool_member_order'), { code: 'invalid_pool_member_order' });
  }
  let current = input.group;
  for (const [index, accountId] of input.accountIds.entries()) {
    const priority = (index + 1) * CONNECTED_SERVICE_POOL_MEMBER_PRIORITY_STEP;
    if (input.members(current).find((member) => member.accountId === accountId)?.priority === priority) continue;
    const next = await input.patch(current, accountId, priority);
    if (!next) return null;
    current = next;
  }
  return current;
}
