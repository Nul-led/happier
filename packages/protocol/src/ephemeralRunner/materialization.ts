import { z } from 'zod';

import { RunnerResourceIdSchema, RunnerSha256CommitmentSchema } from './activation.js';
import { RunnerConsentV1Schema } from './consent.js';
import { RunnerReadinessV1Schema } from './readiness.js';
import { SessionOwnerMetadataEnvelopeV1Schema } from '../sessions/metadata/sessionMetadataEnvelopesV1.js';
import { SessionOrganizationPlacementV1Schema } from '../sessions/creation/sessionSpawnNewResultV1.js';
import { SessionInitialAccessMaterializedV1Schema } from '../sessions/access/sessionInitialAccessDraftV1.js';
import { SessionTeamCredentialBindingIntentsV1Schema } from '../teams/credentials/sessionBindingIntentV1.js';
import { RunnerMachineContentKeyBindingV1Schema } from './machineContentKeyBindingSchema.js';
import {
  machineStoredContentMatchesAccountMode,
  isPlainMachineDataKeyMarker,
} from '../machines/machineStoredContent.js';

const BoundedStoredStringSchema = z.string().max(4 * 1024 * 1024);

export const RunnerSessionMaterializationInputV1Schema = z.object({
  tag: z.string().trim().min(1).max(191),
  metadata: BoundedStoredStringSchema,
  ownerMetadata: SessionOwnerMetadataEnvelopeV1Schema,
  agentState: BoundedStoredStringSchema.nullable(),
  dataEncryptionKey: z.string().min(1).max(4096).nullable(),
  requestedEncryptionMode: z.enum(['plain', 'e2ee']),
  requestedStorageState: z.literal('machine_only').optional(),
  organizationPlacement: SessionOrganizationPlacementV1Schema.optional(),
  initialAccess: SessionInitialAccessMaterializedV1Schema.optional(),
  primaryTeamId: RunnerResourceIdSchema.nullable().optional(),
  teamCredentialBindings: SessionTeamCredentialBindingIntentsV1Schema.optional(),
}).strict();

export const RunnerMachineMaterializationInputV1Schema = z.object({
  metadata: BoundedStoredStringSchema,
  dataEncryptionKey: z.string().min(1).max(4096),
  runnerContentKeyBinding: RunnerMachineContentKeyBindingV1Schema.nullable(),
}).strict().superRefine((value, context) => {
  const plain = isPlainMachineDataKeyMarker(value.dataEncryptionKey);
  if (plain !== (value.runnerContentKeyBinding === null)) {
    context.addIssue({ code: 'custom', path: ['runnerContentKeyBinding'], message: 'Runner Machine content mode and creator key binding must agree' });
  }
});

export const RunnerMaterializationRequestV1Schema = z.object({
  v: z.literal(1),
  activationId: z.string().uuid(),
  launchManifestCommitment: RunnerSha256CommitmentSchema,
  consent: RunnerConsentV1Schema,
  readiness: RunnerReadinessV1Schema,
  sealedBootstrap: z.string().min(1).max(1024 * 1024),
  session: RunnerSessionMaterializationInputV1Schema,
  machine: RunnerMachineMaterializationInputV1Schema,
  accessKeyData: BoundedStoredStringSchema,
}).strict().superRefine((value, context) => {
  const machineIsPlain = isPlainMachineDataKeyMarker(value.machine.dataEncryptionKey);
  if (machineIsPlain !== (value.session.requestedEncryptionMode === 'plain')) {
    context.addIssue({ code: 'custom', path: ['machine', 'dataEncryptionKey'], message: 'Runner Session and Machine content modes must agree' });
  }
  if (!machineStoredContentMatchesAccountMode({
    mode: value.session.requestedEncryptionMode,
    metadata: value.machine.metadata,
    dataEncryptionKey: value.machine.dataEncryptionKey,
  })) {
    context.addIssue({ code: 'custom', path: ['machine', 'metadata'], message: 'Runner Machine stored content must match its Account mode' });
  }
});
export type RunnerMaterializationRequestV1 = z.infer<typeof RunnerMaterializationRequestV1Schema>;

export const RunnerMaterializationResultV1Schema = z.object({
  v: z.literal(1),
  activationId: z.string().uuid(),
  sessionId: RunnerResourceIdSchema,
  machineId: RunnerResourceIdSchema,
}).strict();
export type RunnerMaterializationResultV1 = z.infer<typeof RunnerMaterializationResultV1Schema>;

export const RunnerMaterializationResponseV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('materialized'), result: RunnerMaterializationResultV1Schema }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['activation_closed', 'activation_expired', 'creator_unavailable', 'consent_required', 'readiness_required']),
  }).strict(),
  z.object({
    status: z.literal('conflict'),
    reason: z.enum(['binding_mismatch', 'manifest_mismatch', 'encryption_mismatch', 'identity_taken']),
  }).strict(),
]);
export type RunnerMaterializationResponseV1 = z.infer<typeof RunnerMaterializationResponseV1Schema>;
