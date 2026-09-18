import { z } from 'zod';

import {
  isAccountScopedBlobCiphertextForKind,
  openAccountScopedBlobCiphertext,
  sealAccountScopedBlobCiphertext,
  type AccountScopedBlobKind,
  type AccountScopedCryptoMaterial,
} from '../crypto/accountScopedCipher.js';
import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import {
  AutomationStoredContentEnvelopeV1Schema,
  MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES,
  type AutomationStoredContentEnvelopeV1,
} from '../automations/automationStoredContentEnvelopeV1.js';
import { preservedBoundedNfcString } from '../strings/preservedBoundedNfcString.js';
import { WorkflowAcceptedSnapshotV1Schema } from './workflowDefinitionV1.js';
import {
  WorkflowCheckpointEnvelopeV1Schema,
  WorkflowDecimalV1Schema,
  WorkflowFinalResultV1Schema,
  WorkflowInvocationRecordIdSchema,
  WorkflowProgressEnvelopeV1Schema,
  WorkflowRunIdV1Schema,
} from './workflowProgressV1.js';

const WorkflowAccountIdV1Schema = preservedBoundedNfcString(191, 'Account ids');
const WorkflowStoredBindingBaseV1Schema = z.object({
  v: z.literal(1),
  accountId: WorkflowAccountIdV1Schema,
  runId: WorkflowRunIdV1Schema,
});

export const WorkflowAcceptedSnapshotStoredBindingV1Schema = WorkflowStoredBindingBaseV1Schema.extend({
  purpose: z.literal('accepted_snapshot'),
}).strict();
export const WorkflowInvocationProgressStoredBindingV1Schema = WorkflowStoredBindingBaseV1Schema.extend({
  purpose: z.literal('invocation_progress'),
  recordId: WorkflowInvocationRecordIdSchema,
  sequence: WorkflowDecimalV1Schema,
  parentRecordId: WorkflowInvocationRecordIdSchema.nullable(),
  memberOrdinal: WorkflowDecimalV1Schema,
  attempt: WorkflowDecimalV1Schema,
}).strict();
export const WorkflowCheckpointStoredBindingV1Schema = WorkflowStoredBindingBaseV1Schema.extend({
  purpose: z.literal('checkpoint'),
}).strict();
export const WorkflowFinalResultStoredBindingV1Schema = WorkflowStoredBindingBaseV1Schema.extend({
  purpose: z.literal('final_result'),
}).strict();

export const WorkflowStoredContentBindingV1Schema = z.discriminatedUnion('purpose', [
  WorkflowAcceptedSnapshotStoredBindingV1Schema,
  WorkflowInvocationProgressStoredBindingV1Schema,
  WorkflowCheckpointStoredBindingV1Schema,
  WorkflowFinalResultStoredBindingV1Schema,
]);
export type WorkflowStoredContentBindingV1 = z.infer<typeof WorkflowStoredContentBindingV1Schema>;
export type WorkflowAcceptedSnapshotStoredBindingV1 = z.infer<typeof WorkflowAcceptedSnapshotStoredBindingV1Schema>;
export type WorkflowInvocationProgressStoredBindingV1 = z.infer<typeof WorkflowInvocationProgressStoredBindingV1Schema>;
export type WorkflowCheckpointStoredBindingV1 = z.infer<typeof WorkflowCheckpointStoredBindingV1Schema>;
export type WorkflowFinalResultStoredBindingV1 = z.infer<typeof WorkflowFinalResultStoredBindingV1Schema>;

const WorkflowAcceptedSnapshotStoredPayloadV1Schema = z.object({
  v: z.literal(1), binding: WorkflowAcceptedSnapshotStoredBindingV1Schema,
  content: WorkflowAcceptedSnapshotV1Schema,
}).strict();
const WorkflowInvocationProgressStoredPayloadV1Schema = z.object({
  v: z.literal(1), binding: WorkflowInvocationProgressStoredBindingV1Schema,
  content: WorkflowProgressEnvelopeV1Schema,
}).strict();
const WorkflowCheckpointStoredPayloadV1Schema = z.object({
  v: z.literal(1), binding: WorkflowCheckpointStoredBindingV1Schema,
  content: WorkflowCheckpointEnvelopeV1Schema,
}).strict();
const WorkflowFinalResultStoredPayloadV1Schema = z.object({
  v: z.literal(1), binding: WorkflowFinalResultStoredBindingV1Schema,
  content: WorkflowFinalResultV1Schema,
}).strict();

export const WorkflowStoredContentEnvelopeV1Schema = AutomationStoredContentEnvelopeV1Schema;
export type WorkflowStoredContentEnvelopeV1 = AutomationStoredContentEnvelopeV1;

export type WorkflowStoredContentOpenFailureV1 =
  | Readonly<{ kind: 'materialUnavailable' }>
  | Readonly<{ kind: 'contentInvalid' }>
  | Readonly<{ kind: 'modeMismatch' }>
  | Readonly<{ kind: 'bindingMismatch' }>;
export type WorkflowStoredContentOuterValidationV1 =
  | Readonly<{ kind: 'available'; envelope: WorkflowStoredContentEnvelopeV1 }>
  | Exclude<WorkflowStoredContentOpenFailureV1, Readonly<{ kind: 'materialUnavailable' }>>;

type WorkflowStoredEnvelopeSealModeV1 =
  | Readonly<{ mode: 'plain' }>
  | Readonly<{
      mode: 'e2ee'; material: AccountScopedCryptoMaterial;
      randomBytes: (length: number) => Uint8Array;
    }>;

const WORKFLOW_ACCOUNT_SCOPED_BLOB_KIND_BY_PURPOSE = {
  accepted_snapshot: 'workflow_accepted_snapshot',
  invocation_progress: 'workflow_invocation_progress',
  checkpoint: 'workflow_checkpoint',
  final_result: 'workflow_final_result',
} as const satisfies Record<WorkflowStoredContentBindingV1['purpose'], AccountScopedBlobKind>;

type ParsedWorkflowStoredPayloadV1 = Readonly<{
  binding: WorkflowStoredContentBindingV1;
  content: unknown;
}>;

function parsePayloadForBinding(
  binding: WorkflowStoredContentBindingV1,
  value: unknown,
): ParsedWorkflowStoredPayloadV1 | null {
  switch (binding.purpose) {
    case 'accepted_snapshot': {
      const parsed = WorkflowAcceptedSnapshotStoredPayloadV1Schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case 'invocation_progress': {
      const parsed = WorkflowInvocationProgressStoredPayloadV1Schema.safeParse(value);
      if (!parsed.success || parsed.data.content.attempt !== parsed.data.binding.attempt) return null;
      if (parsed.data.binding.attempt === '0'
        && parsed.data.content.logicalInvocationRecordId !== parsed.data.binding.recordId) return null;
      return parsed.data;
    }
    case 'checkpoint': {
      const parsed = WorkflowCheckpointStoredPayloadV1Schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case 'final_result': {
      const parsed = WorkflowFinalResultStoredPayloadV1Schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
  }
}

function sameBinding(left: WorkflowStoredContentBindingV1, right: WorkflowStoredContentBindingV1): boolean {
  return createCanonicalJsonSigningInput(left) === createCanonicalJsonSigningInput(right);
}

export function validateWorkflowStoredEnvelopeOuterForModeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowStoredContentBindingV1; envelope: unknown;
}>): WorkflowStoredContentOuterValidationV1 {
  const binding = WorkflowStoredContentBindingV1Schema.safeParse(params.binding);
  const envelope = WorkflowStoredContentEnvelopeV1Schema.safeParse(params.envelope);
  if (!binding.success || !envelope.success) return { kind: 'contentInvalid' };
  if ((params.mode === 'plain' && envelope.data.t !== 'plain')
    || (params.mode === 'e2ee' && envelope.data.t !== 'encrypted')) {
    return { kind: 'modeMismatch' };
  }
  if (envelope.data.t === 'encrypted') {
    return isAccountScopedBlobCiphertextForKind({
      kind: WORKFLOW_ACCOUNT_SCOPED_BLOB_KIND_BY_PURPOSE[binding.data.purpose],
      ciphertext: envelope.data.c,
    }) ? { kind: 'available', envelope: envelope.data } : { kind: 'contentInvalid' };
  }
  const payload = parsePayloadForBinding(binding.data, envelope.data.v);
  if (!payload) return { kind: 'contentInvalid' };
  return sameBinding(payload.binding, binding.data)
    ? { kind: 'available', envelope: envelope.data }
    : { kind: 'bindingMismatch' };
}

function sealWorkflowStoredEnvelopeV1(params: Readonly<{
  binding: WorkflowStoredContentBindingV1; payload: unknown;
}> & WorkflowStoredEnvelopeSealModeV1): WorkflowStoredContentEnvelopeV1 {
  const binding = WorkflowStoredContentBindingV1Schema.parse(params.binding);
  const payload = parsePayloadForBinding(binding, params.payload);
  if (!payload) throw new TypeError('Invalid Workflow stored content payload');
  if (params.mode === 'plain') {
    return WorkflowStoredContentEnvelopeV1Schema.parse({ t: 'plain', v: payload });
  }
  return WorkflowStoredContentEnvelopeV1Schema.parse({
    t: 'encrypted',
    c: sealAccountScopedBlobCiphertext({
      kind: WORKFLOW_ACCOUNT_SCOPED_BLOB_KIND_BY_PURPOSE[binding.purpose],
      material: params.material,
      payload,
      randomBytes: params.randomBytes,
    }),
  });
}

function openWorkflowStoredEnvelopeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowStoredContentBindingV1;
  envelope: unknown; material?: AccountScopedCryptoMaterial;
}>): Readonly<{ kind: 'available'; content: unknown }> | WorkflowStoredContentOpenFailureV1 {
  const binding = WorkflowStoredContentBindingV1Schema.safeParse(params.binding);
  if (!binding.success) return { kind: 'contentInvalid' };
  const outer = validateWorkflowStoredEnvelopeOuterForModeV1({ ...params, binding: binding.data });
  if (outer.kind !== 'available') return outer;
  let rawPayload: unknown;
  if (outer.envelope.t === 'plain') {
    rawPayload = outer.envelope.v;
  } else {
    if (!params.material) return { kind: 'materialUnavailable' };
    const opened = openAccountScopedBlobCiphertext({
      kind: WORKFLOW_ACCOUNT_SCOPED_BLOB_KIND_BY_PURPOSE[binding.data.purpose],
      material: params.material,
      ciphertext: outer.envelope.c,
    });
    if (!opened) return { kind: 'contentInvalid' };
    rawPayload = opened.value;
  }
  const payload = parsePayloadForBinding(binding.data, rawPayload);
  if (!payload) return { kind: 'contentInvalid' };
  if (!sameBinding(payload.binding, binding.data)) return { kind: 'bindingMismatch' };
  return { kind: 'available', content: payload.content };
}

function narrowOpenedWorkflowContentV1<T>(
  opened: ReturnType<typeof openWorkflowStoredEnvelopeV1>,
  schema: z.ZodType<T>,
): Readonly<{ kind: 'available'; content: T }> | WorkflowStoredContentOpenFailureV1 {
  if (opened.kind !== 'available') return opened;
  const content = schema.safeParse(opened.content);
  return content.success ? { kind: 'available', content: content.data } : { kind: 'contentInvalid' };
}

export function sealWorkflowAcceptedSnapshotStoredEnvelopeV1(params: Readonly<{
  binding: WorkflowAcceptedSnapshotStoredBindingV1;
  acceptedSnapshot: z.infer<typeof WorkflowAcceptedSnapshotV1Schema>;
}> & WorkflowStoredEnvelopeSealModeV1): WorkflowStoredContentEnvelopeV1 {
  return sealWorkflowStoredEnvelopeV1({
    ...params, payload: { v: 1, binding: params.binding, content: params.acceptedSnapshot },
  });
}
export function openWorkflowAcceptedSnapshotStoredEnvelopeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowAcceptedSnapshotStoredBindingV1;
  envelope: unknown; material?: AccountScopedCryptoMaterial;
}>) {
  return narrowOpenedWorkflowContentV1(openWorkflowStoredEnvelopeV1(params), WorkflowAcceptedSnapshotV1Schema);
}

export function sealWorkflowProgressStoredEnvelopeV1(params: Readonly<{
  binding: WorkflowInvocationProgressStoredBindingV1;
  progress: z.infer<typeof WorkflowProgressEnvelopeV1Schema>;
}> & WorkflowStoredEnvelopeSealModeV1): WorkflowStoredContentEnvelopeV1 {
  return sealWorkflowStoredEnvelopeV1({
    ...params, payload: { v: 1, binding: params.binding, content: params.progress },
  });
}
export function openWorkflowProgressStoredEnvelopeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowInvocationProgressStoredBindingV1;
  envelope: unknown; material?: AccountScopedCryptoMaterial;
}>) {
  return narrowOpenedWorkflowContentV1(openWorkflowStoredEnvelopeV1(params), WorkflowProgressEnvelopeV1Schema);
}

export function sealWorkflowCheckpointStoredEnvelopeV1(params: Readonly<{
  binding: WorkflowCheckpointStoredBindingV1;
  checkpoint: z.infer<typeof WorkflowCheckpointEnvelopeV1Schema>;
}> & WorkflowStoredEnvelopeSealModeV1): WorkflowStoredContentEnvelopeV1 {
  return sealWorkflowStoredEnvelopeV1({
    ...params, payload: { v: 1, binding: params.binding, content: params.checkpoint },
  });
}
export function openWorkflowCheckpointStoredEnvelopeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowCheckpointStoredBindingV1;
  envelope: unknown; material?: AccountScopedCryptoMaterial;
}>) {
  return narrowOpenedWorkflowContentV1(openWorkflowStoredEnvelopeV1(params), WorkflowCheckpointEnvelopeV1Schema);
}

export function sealWorkflowFinalResultStoredEnvelopeV1(params: Readonly<{
  binding: WorkflowFinalResultStoredBindingV1;
  finalResult: z.infer<typeof WorkflowFinalResultV1Schema>;
}> & WorkflowStoredEnvelopeSealModeV1): WorkflowStoredContentEnvelopeV1 {
  return sealWorkflowStoredEnvelopeV1({
    ...params, payload: { v: 1, binding: params.binding, content: params.finalResult },
  });
}
export function openWorkflowFinalResultStoredEnvelopeV1(params: Readonly<{
  mode: 'plain' | 'e2ee'; binding: WorkflowFinalResultStoredBindingV1;
  envelope: unknown; material?: AccountScopedCryptoMaterial;
}>) {
  return narrowOpenedWorkflowContentV1(openWorkflowStoredEnvelopeV1(params), WorkflowFinalResultV1Schema);
}

export function serializeWorkflowStoredContentEnvelopeV1(envelope: unknown): string {
  return createCanonicalJsonSigningInput(WorkflowStoredContentEnvelopeV1Schema.parse(envelope));
}

export function parseWorkflowStoredContentEnvelopeV1(serialized: unknown): WorkflowStoredContentEnvelopeV1 | null {
  if (typeof serialized !== 'string'
    || new TextEncoder().encode(serialized).byteLength > MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES) return null;
  try {
    const parsed = WorkflowStoredContentEnvelopeV1Schema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
