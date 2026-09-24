import { z } from 'zod';

import { AccountSettingsStoredContentEnvelopeSchema } from './accountSettingsStoredContentEnvelope.js';
import { SavedSecretCatalogResultV1Schema } from './savedSecretCatalogV1.js';
import { SavedSecretResourceStoredContentV1Schema } from './savedSecretResourceContentSchemaV1.js';
import { readCanonicalPaddedBase64DecodedLength } from '../../crypto/base64.js';
import { ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES } from '../../crypto/encryptedDataKeyEnvelopeFormatV1.js';

export const SHARED_SAVED_SECRET_ACTION_IDS_V1 = [
  'secrets.shared.list',
  'secrets.shared.create',
  'secrets.shared.promote',
  'secrets.shared.grants.set',
  'secrets.shared.update',
  'secrets.shared.delete',
] as const;

export type SharedSavedSecretActionIdV1 = typeof SHARED_SAVED_SECRET_ACTION_IDS_V1[number];
export const SharedSavedSecretActionIdV1Schema = z.enum(SHARED_SAVED_SECRET_ACTION_IDS_V1);

const ResourceIdSchema = z.string().min(1).max(128);
const GrantIdSchema = z.string().min(1);

export const SavedSecretResourceRecipientEnvelopeInputV1Schema = z.object({
  recipientAccountId: z.string().min(1),
  encryptedDataKey: z.string().refine(
    (value) => readCanonicalPaddedBase64DecodedLength(value) === ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES,
    'Expected one canonical encrypted data-key envelope',
  ),
  recipientContentPublicKeyFingerprint: z.string().min(1),
}).strict();

export const SharedSavedSecretListInputV1Schema = z.object({}).strict();
export const SharedSavedSecretListOutputV1Schema = z.object({
  resources: z.array(SavedSecretCatalogResultV1Schema),
}).strict();

export const SharedSavedSecretCreateInputV1Schema = z.object({
  resourceId: ResourceIdSchema,
  displayName: z.string().min(1).max(100),
  kind: z.enum(['apiKey', 'token', 'password', 'other']),
  encryptionMode: z.enum(['plain', 'e2ee']),
  storedContent: SavedSecretResourceStoredContentV1Schema,
  accountGrants: z.array(GrantIdSchema).optional(),
  teamGrants: z.array(GrantIdSchema).optional(),
  groupGrants: z.array(GrantIdSchema).optional(),
  keyEnvelopes: z.array(SavedSecretResourceRecipientEnvelopeInputV1Schema).optional(),
}).strict();

export const SharedSavedSecretPromoteInputV1Schema = SharedSavedSecretCreateInputV1Schema.extend({
  expectedSettingsVersion: z.number().int().nonnegative(),
  nextSettings: AccountSettingsStoredContentEnvelopeSchema.nullable(),
}).strict();

export const SharedSavedSecretGrantsSetInputV1Schema = z.object({
  resourceId: ResourceIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  accountGrants: z.array(GrantIdSchema),
  teamGrants: z.array(GrantIdSchema),
  groupGrants: z.array(GrantIdSchema),
  /** Complete current E2EE recipient envelopes for the replacement audience. */
  keyEnvelopes: z.array(SavedSecretResourceRecipientEnvelopeInputV1Schema).optional(),
}).strict();

/** Internal owner repair after an audience/key change; this is not an Action. */
export const SavedSecretResourceEnvelopeRepairInputV1Schema = z.object({
  resourceId: ResourceIdSchema,
  expectedRevision: z.number().int().positive(),
  keyEnvelopes: z.array(SavedSecretResourceRecipientEnvelopeInputV1Schema).min(1),
}).strict();

export const SharedSavedSecretUpdateInputV1Schema = z.object({
  resourceId: ResourceIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  displayName: z.string().min(1).max(100),
  kind: z.enum(['apiKey', 'token', 'password', 'other']),
  storedContent: SavedSecretResourceStoredContentV1Schema,
  /**
   * Explicit owner mode conversion (plan 10.08 §10.5/§11.0). Absent keeps the
   * resource's current mode, so rename and value rotation are unchanged; the
   * submitted `storedContent` must always match the resulting mode.
   */
  toMode: z.enum(['plain', 'e2ee']).optional(),
  /** Owner and current-recipient envelopes for a Plain to E2EE conversion. */
  keyEnvelopes: z.array(SavedSecretResourceRecipientEnvelopeInputV1Schema).optional(),
}).strict();

export const SharedSavedSecretDeleteInputV1Schema = z.object({
  // Deletion is also the recovery path for retained corrupt rows, whose opaque
  // database identity must not be reinterpreted as a canonical resource id.
  resourceId: z.string(),
  expectedRevision: z.number().int(),
}).strict();

export const SharedSavedSecretMutationOutputV1Schema = z.object({
  resourceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
}).strict();
export const SavedSecretResourceEnvelopeRepairOutputV1Schema = SharedSavedSecretMutationOutputV1Schema;
export const SharedSavedSecretPromoteOutputV1Schema = z.object({
  resourceId: z.string().min(1),
  settingsVersion: z.number().int().nonnegative(),
}).strict();
export const SharedSavedSecretDeleteOutputV1Schema = z.object({ resourceId: z.string() }).strict();

export const SavedSecretResourceActionErrorV1Schema = z.object({
  error: z.enum([
    'invalid_resource', 'resource_not_found', 'forbidden', 'resource_changed',
    'recipient_changed', 'recipient_key_unavailable', 'invalid_cursor',
    'recipient_mode_unsupported', 'settings_conflict', 'settings_invalid', 'internal',
  ]),
}).strict();

export const SHARED_SAVED_SECRET_ACTION_PATHS_V1 = {
  'secrets.shared.list': '/v1/account/saved-secrets/resources',
  'secrets.shared.create': '/v1/account/saved-secrets/resources',
  'secrets.shared.promote': '/v1/account/saved-secrets/resources/promote',
  'secrets.shared.grants.set': '/v1/account/saved-secrets/resources/grants',
  'secrets.shared.update': '/v1/account/saved-secrets/resources/update',
  'secrets.shared.delete': '/v1/account/saved-secrets/resources/delete',
} as const satisfies Readonly<Record<SharedSavedSecretActionIdV1, string>>;

export const SHARED_SAVED_SECRET_ACTION_METHODS_V1 = {
  'secrets.shared.list': 'GET',
  'secrets.shared.create': 'POST',
  'secrets.shared.promote': 'POST',
  'secrets.shared.grants.set': 'POST',
  'secrets.shared.update': 'POST',
  'secrets.shared.delete': 'POST',
} as const satisfies Readonly<Record<SharedSavedSecretActionIdV1, 'GET' | 'POST'>>;

export const SHARED_SAVED_SECRET_ACTION_INPUT_SCHEMAS_V1 = {
  'secrets.shared.list': SharedSavedSecretListInputV1Schema,
  'secrets.shared.create': SharedSavedSecretCreateInputV1Schema,
  'secrets.shared.promote': SharedSavedSecretPromoteInputV1Schema,
  'secrets.shared.grants.set': SharedSavedSecretGrantsSetInputV1Schema,
  'secrets.shared.update': SharedSavedSecretUpdateInputV1Schema,
  'secrets.shared.delete': SharedSavedSecretDeleteInputV1Schema,
} as const satisfies Readonly<Record<SharedSavedSecretActionIdV1, z.ZodTypeAny>>;

export const SHARED_SAVED_SECRET_ACTION_OUTPUT_SCHEMAS_V1 = {
  'secrets.shared.list': SharedSavedSecretListOutputV1Schema,
  'secrets.shared.create': SharedSavedSecretMutationOutputV1Schema,
  'secrets.shared.promote': SharedSavedSecretPromoteOutputV1Schema,
  'secrets.shared.grants.set': SharedSavedSecretMutationOutputV1Schema,
  'secrets.shared.update': SharedSavedSecretMutationOutputV1Schema,
  'secrets.shared.delete': SharedSavedSecretDeleteOutputV1Schema,
} as const satisfies Readonly<Record<SharedSavedSecretActionIdV1, z.ZodTypeAny>>;
