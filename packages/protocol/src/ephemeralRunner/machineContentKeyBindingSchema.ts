import { z } from 'zod';

import { RunnerResourceIdSchema, RunnerSignatureSchema } from './activation.js';

export const RUNNER_MACHINE_CONTENT_KEY_FINGERPRINT_PREFIX = 'runner-machine-content-key-sha256:' as const;

export const RunnerMachineContentKeyFingerprintV1Schema = z.string().regex(
  /^runner-machine-content-key-sha256:[a-f0-9]{64}$/,
);

export const RunnerMachineContentKeyBindingPayloadV1Schema = z.object({
  v: z.literal(1),
  purpose: z.literal('happier.ephemeral-runner.machine-content-key'),
  homeServerIdentityId: RunnerResourceIdSchema,
  activationId: z.string().uuid(),
  creatorAccountId: RunnerResourceIdSchema,
  machineId: RunnerResourceIdSchema,
  installationId: RunnerResourceIdSchema,
  machineContentKeyFingerprint: RunnerMachineContentKeyFingerprintV1Schema,
}).strict();
export type RunnerMachineContentKeyBindingPayloadV1 = z.infer<
  typeof RunnerMachineContentKeyBindingPayloadV1Schema
>;

export const RunnerMachineContentKeyBindingV1Schema = RunnerMachineContentKeyBindingPayloadV1Schema.extend({
  accountSignatureBase64Url: RunnerSignatureSchema,
}).strict();
export type RunnerMachineContentKeyBindingV1 = z.infer<typeof RunnerMachineContentKeyBindingV1Schema>;
