import { z } from 'zod';

import { RunnerPublicKeySchema, RunnerResourceIdSchema } from './activation.js';

export const VerifiedEphemeralSessionRunnerPrincipalSchema = z.object({
  kind: z.literal('ephemeral_session_runner'),
  authority: z.literal('session_runtime'),
  accountId: RunnerResourceIdSchema,
  activationId: z.string().uuid(),
  sessionId: RunnerResourceIdSchema,
  machineId: RunnerResourceIdSchema,
  installationId: RunnerResourceIdSchema,
  installationPublicKey: RunnerPublicKeySchema,
  creatorTokenEpoch: z.number().int().nonnegative().safe(),
}).strict().readonly();
export type VerifiedEphemeralSessionRunnerPrincipal = z.infer<typeof VerifiedEphemeralSessionRunnerPrincipalSchema>;
