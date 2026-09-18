import { z } from 'zod';

import { RunnerResourceIdSchema, RunnerSha256CommitmentSchema } from './activation.js';
import { RunnerMachineContentKeyBindingV1Schema } from './machineContentKeyBindingSchema.js';
import { decodeCanonicalBase64UrlFixedLength } from '../machines/peer/mediation/strictBase64Url.js';

const RuntimeBootstrapCommonV1Schema = z.object({
  v: z.literal(1),
  purpose: z.literal('happier.ephemeral-session-runner.runtime'),
  homeServerIdentityId: RunnerResourceIdSchema,
  activationId: z.string().uuid(),
  creatorAccountId: RunnerResourceIdSchema,
  sessionId: RunnerResourceIdSchema,
  machineId: RunnerResourceIdSchema,
  installationId: RunnerResourceIdSchema,
  launchManifestCommitment: RunnerSha256CommitmentSchema,
}).strict();

const Key32Base64UrlSchema = z.string().length(43).refine(
  (value) => decodeCanonicalBase64UrlFixedLength(value, 32) !== null,
  'Expected canonical unpadded base64url key',
);

export const RunnerRuntimeBootstrapV1Schema = z.union([
  RuntimeBootstrapCommonV1Schema.extend({
    storedContent: z.object({ mode: z.literal('plain') }).strict(),
    machineContent: z.object({ mode: z.literal('plain') }).strict(),
  }).strict(),
  RuntimeBootstrapCommonV1Schema.extend({
    storedContent: z.object({ mode: z.literal('e2ee'), sessionDataEncryptionKey: Key32Base64UrlSchema }).strict(),
    machineContent: z.object({
      mode: z.literal('e2ee'),
      machineContentKeyBase64Url: Key32Base64UrlSchema,
      binding: RunnerMachineContentKeyBindingV1Schema,
    }).strict(),
  }).strict(),
]);
export type RunnerRuntimeBootstrapV1 = z.infer<typeof RunnerRuntimeBootstrapV1Schema>;
