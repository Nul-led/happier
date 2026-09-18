import { z } from 'zod';

import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { PluginContributionIdentityV1Schema } from '../plugins/contributionIdentity.js';

export const ConnectedAccountPurposeIdSchema = z.string().trim().min(1).max(128);
export type ConnectedAccountPurposeId = z.infer<typeof ConnectedAccountPurposeIdSchema>;

export const QualifiedConnectedAccountPurposeV1Schema = z.object({
  consumer: asProtocolZod(PluginContributionIdentityV1Schema),
  purpose: ConnectedAccountPurposeIdSchema,
}).strict();
export type QualifiedConnectedAccountPurposeV1 = z.infer<
  typeof QualifiedConnectedAccountPurposeV1Schema
>;
