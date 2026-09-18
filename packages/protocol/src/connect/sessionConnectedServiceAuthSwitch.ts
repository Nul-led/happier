import { z } from 'zod';

import {
  ConnectedAccountServiceKeySchema,
  ConnectedServiceBindingsV2IngressSchema,
} from './connectedServiceBindings.js';
import { SessionTeamCredentialBindingIntentsV1Schema } from '../teams/credentials/sessionBindingIntentV1.js';

export const SessionConnectedServiceAuthSwitchRpcParamsSchema = z.object({
  sessionId: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  // Current callers write V2. Released V1 callers remain a required
  // new-daemon/old-client ingress and normalize before domain logic.
  bindings: ConnectedServiceBindingsV2IngressSchema,
  rematerializeServiceId: ConnectedAccountServiceKeySchema.optional(),
  expectedGroupGenerationByServiceId: z.record(
    ConnectedAccountServiceKeySchema,
    z.number().int().nonnegative(),
  ).optional(),
  teamCredentialBindings: SessionTeamCredentialBindingIntentsV1Schema.min(1).optional(),
  previousTeamCredentialBindings: SessionTeamCredentialBindingIntentsV1Schema.min(1).optional(),
  teamVisibilityGrantConsent: z.object({ teamId: z.string().min(1) }).strict().optional(),
  accountSettingsVersionHint: z.number().int().nonnegative().optional(),
}).strict();

export type SessionConnectedServiceAuthSwitchRpcParams = z.infer<
  typeof SessionConnectedServiceAuthSwitchRpcParamsSchema
>;
