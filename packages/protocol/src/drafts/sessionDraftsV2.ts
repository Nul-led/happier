import { z } from 'zod';

import { StrictJsonValueSchema } from '../json/strictJsonValue.js';
import { normalizeParticipantRecipientRoutingIdentityV1 } from '../messages/structured/participantMessageV1.js';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import {
  SyncedSessionAuthoringFieldIdV1Schema,
  SyncedSessionAuthoringValueV1Schema,
} from '../sessions/authoring/syncedSessionAuthoringV1.js';
import {
  SessionAuthoringExecutionTargetV2Schema,
  SyncedSessionAuthoringValueV2Schema,
} from '../sessions/authoring/index.js';
import {
  ExecutionRunIdSchema,
  SessionDiscussionIdSchema,
  SessionIdSchema,
} from '../sessions/idsV1.js';
import {
  SESSION_DRAFT_MAX_CIPHERTEXT_LENGTH,
  SESSION_DRAFT_MAX_PRIVATE_PAYLOAD_BYTES,
  SESSION_DRAFT_MAX_FIELDS,
  DraftFieldV1Schema,
  SessionDraftAddressV1Schema,
  SessionDraftDocumentV1Schema,
  SessionDraftExpectedRevisionV1Schema,
  SessionDraftPrivatePayloadV1Schema,
  SessionDraftStoredContentEnvelopeV1Schema,
  SessionDraftRecipientValueV1Schema,
  canonicalSessionDraftAddressV1,
  createSessionDraftAuthoringFieldsSchema,
  type SessionDraftAddressV1,
  type SessionDraftDocumentV1,
} from './sessionDrafts.js';

/**
 * V2 adds draft addresses and new-session authoring intent through the same
 * repository, KV prefix, revision CAS, cipher and lifecycle owners. Strict V1
 * operations neither expose nor rewrite successor addresses or content.
 */

export const SESSION_DRAFT_V2_SOCKET_EVENT = 'session-draft-v2-updated' as const;
export const SESSION_DRAFT_V2_ROUTE_READ = '/v2/account/session-drafts/read' as const;
export const SESSION_DRAFT_V2_ROUTE_LIST = '/v2/account/session-drafts/list' as const;
export const SESSION_DRAFT_V2_ROUTE_MUTATE = '/v2/account/session-drafts/mutate' as const;

const RunDraftAddressSchema = z.object({
  kind: z.literal('run'),
  sessionId: asProtocolZod(SessionIdSchema),
  runId: ExecutionRunIdSchema,
}).strict();
const DiscussionDraftAddressSchema = z.object({
  kind: z.literal('discussion'),
  sessionId: asProtocolZod(SessionIdSchema),
  discussionId: SessionDiscussionIdSchema,
}).strict();
const NewDiscussionDraftAddressSchema = z.object({
  kind: z.literal('newDiscussion'),
  sessionId: asProtocolZod(SessionIdSchema),
}).strict();

/** The address arms V1 cannot express; every one of them binds an existing Session. */
export const SessionDraftAddressV2OnlySchema = z.union([
  RunDraftAddressSchema,
  DiscussionDraftAddressSchema,
  NewDiscussionDraftAddressSchema,
]);
export type SessionDraftAddressV2Only = z.infer<typeof SessionDraftAddressV2OnlySchema>;

export const SessionDraftAddressV2Schema = z.union([
  SessionDraftAddressV1Schema,
  SessionDraftAddressV2OnlySchema,
]);
export type SessionDraftAddressV2 = z.infer<typeof SessionDraftAddressV2Schema>;

export function isSessionDraftAddressV1(address: SessionDraftAddressV2): address is SessionDraftAddressV1 {
  return address.kind === 'newSession' || address.kind === 'session';
}

const NEW_DISCUSSION_SEGMENT = 'new-discussion';

export function canonicalSessionDraftAddressV2(address: SessionDraftAddressV2): string {
  if (isSessionDraftAddressV1(address)) return canonicalSessionDraftAddressV1(address);
  const session = `session/${encodeURIComponent(address.sessionId)}`;
  if (address.kind === 'run') return `${session}/run/${encodeURIComponent(address.runId)}`;
  if (address.kind === 'discussion') {
    return `${session}/discussion/${encodeURIComponent(address.discussionId)}`;
  }
  return `${session}/${NEW_DISCUSSION_SEGMENT}`;
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Parses an exact canonical address. Round-trip equality is required, so a
 * non-canonical encoding of the same identifiers is rejected rather than
 * aliased onto a neighbouring row.
 */
export function parseCanonicalSessionDraftAddressV2(value: string): SessionDraftAddressV2 | null {
  const candidate = ((): unknown => {
    if (value.startsWith('new-session/')) {
      return { kind: 'newSession', draftId: value.slice('new-session/'.length) };
    }
    if (!value.startsWith('session/')) return null;
    const segments = value.slice('session/'.length).split('/');
    const sessionId = decodeSegment(segments[0] ?? '');
    if (sessionId === null) return null;
    if (segments.length === 1) return { kind: 'session', sessionId };
    if (segments.length === 2 && segments[1] === NEW_DISCUSSION_SEGMENT) {
      return { kind: 'newDiscussion', sessionId };
    }
    if (segments.length !== 3) return null;
    const identifier = decodeSegment(segments[2] ?? '');
    if (identifier === null) return null;
    if (segments[1] === 'run') return { kind: 'run', sessionId, runId: identifier };
    if (segments[1] === 'discussion') return { kind: 'discussion', sessionId, discussionId: identifier };
    return null;
  })();
  if (candidate === null) return null;
  const parsed = SessionDraftAddressV2Schema.safeParse(candidate);
  return parsed.success && canonicalSessionDraftAddressV2(parsed.data) === value ? parsed.data : null;
}

export const CanonicalSessionDraftAddressV2Schema = z.string().min(1).refine(
  (value) => parseCanonicalSessionDraftAddressV2(value) !== null,
  'Expected a canonical session draft address',
);
export type CanonicalSessionDraftAddressV2 = z.infer<typeof CanonicalSessionDraftAddressV2Schema>;

const DiscussionDraftFieldSchema = <T extends z.ZodTypeAny>(value: T) => z.object({
  mutationId: z.string().uuid(),
  value,
}).strict();

/**
 * Human conversation drafts (Lane 05.03 semantics) composed at this one draft
 * document owner. They carry no Agent routing, delivery, authoring or
 * attachment bytes.
 */
export const SessionDiscussionDraftDocumentV2Schema = z.object({
  v: z.literal(2),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('discussion') }).strict(),
    z.object({ kind: z.literal('newDiscussion') }).strict(),
  ]),
  composer: z.object({
    text: DiscussionDraftFieldSchema(z.string()),
    mentions: DiscussionDraftFieldSchema(z.array(StrictJsonValueSchema)),
    attachments: DiscussionDraftFieldSchema(z.array(z.never()).max(0)),
  }).strict(),
  title: DiscussionDraftFieldSchema(z.string()).optional(),
}).strict().superRefine((document, context) => {
  if (document.title && document.target.kind !== 'newDiscussion') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['title'],
      message: 'Only a new-discussion draft carries a title field',
    });
  }
});
export type SessionDiscussionDraftDocumentV2 = z.infer<typeof SessionDiscussionDraftDocumentV2Schema>;

/** New-session intent evolves here, never by widening the released V1 document. */
export const NewSessionDraftDocumentV2Schema = z.object({
  v: z.literal(2),
  composer: SessionDraftDocumentV1Schema.shape.composer,
  target: z.object({
    kind: z.literal('newSession'),
    authoring: createSessionDraftAuthoringFieldsSchema(SyncedSessionAuthoringValueV2Schema),
  }).strict(),
  extensions: SessionDraftDocumentV1Schema.shape.extensions,
}).strict().superRefine((document, context) => {
  const extensionFields = Object.values(document.extensions)
    .reduce((count, fields) => count + Object.keys(fields).length, 0);
  if (3 + Object.keys(document.target.authoring).length + extensionFields > SESSION_DRAFT_MAX_FIELDS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft field count exceeds the supported boundary' });
  }
});
export type NewSessionDraftDocumentV2 = z.infer<typeof NewSessionDraftDocumentV2Schema>;

const SUPPORTED_PREDECESSOR_SUCCESSOR_NEW_SESSION_FIELD_IDS = new Set([
  'executionTarget',
  'organizationPlacement',
  'agentTarget',
  'modelSelection',
  'runtimeDescriptorV1',
]);
const SupportedPredecessorSuccessorNewSessionFieldIdSchema = z.enum([
  'executionTarget',
  'organizationPlacement',
  'agentTarget',
  'modelSelection',
  'runtimeDescriptorV1',
]);

const SupportedPredecessorNewSessionDraftDocumentV1Schema = z.object({
  v: z.literal(1),
  composer: SessionDraftDocumentV1Schema.shape.composer,
  target: z.object({
    kind: z.literal('newSession'),
    authoring: z.partialRecord(
      z.union([SyncedSessionAuthoringFieldIdV1Schema, SupportedPredecessorSuccessorNewSessionFieldIdSchema]),
      DraftFieldV1Schema,
    ),
  }).strict(),
  extensions: SessionDraftDocumentV1Schema.shape.extensions,
}).strict().superRefine((document, context) => {
  for (const [fieldId, field] of Object.entries(document.target.authoring)) {
    if (SUPPORTED_PREDECESSOR_SUCCESSOR_NEW_SESSION_FIELD_IDS.has(fieldId)) continue;
    const predecessorSchema = SyncedSessionAuthoringValueV1Schema.shape[
      fieldId as keyof typeof SyncedSessionAuthoringValueV1Schema.shape
    ];
    if (!predecessorSchema?.safeParse(field?.value).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target', 'authoring', fieldId, 'value'],
        message: `Invalid supported-predecessor authoring value for ${fieldId}`,
      });
    }
  }
  const extensionFields = Object.values(document.extensions)
    .reduce((count, fields) => count + Object.keys(fields).length, 0);
  if (3 + Object.keys(document.target.authoring).length + extensionFields > SESSION_DRAFT_MAX_FIELDS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft field count exceeds the supported boundary' });
  }
});

const SupportedPredecessorNewSessionDraftPrivatePayloadV1Schema = z.object({
  v: z.literal(1),
  address: SessionDraftAddressV1Schema.options[0],
  document: SupportedPredecessorNewSessionDraftDocumentV1Schema,
}).strict().superRefine((payload, context) => {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > SESSION_DRAFT_MAX_PRIVATE_PAYLOAD_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft private payload exceeds the supported boundary' });
  }
});

/**
 * Exact lossless projection accepted by the moving supported 0.2 Home.
 *
 * The predecessor's strict V1 document deliberately preserves the five named
 * successor fields as opaque DraftFieldV1 values without treating them as
 * execution authority. Incumbent V1 fields must still satisfy their released
 * value schemas. Any other current field keeps the write on V2.
 */
export type SupportedPredecessorNewSessionDraftDocumentV1 = z.infer<
  typeof SupportedPredecessorNewSessionDraftDocumentV1Schema
>;

export type SupportedPredecessorNewSessionDraftPrivatePayloadV1 = z.infer<
  typeof SupportedPredecessorNewSessionDraftPrivatePayloadV1Schema
>;

export type SupportedPredecessorNewSessionDraftContentV1 =
  | Readonly<{ t: 'plain'; v: SupportedPredecessorNewSessionDraftPrivatePayloadV1 }>
  | Readonly<{ t: 'encrypted'; c: string }>;

export function projectNewSessionDraftDocumentToSupportedPredecessorV1(
  document: NewSessionDraftDocumentV2,
): SupportedPredecessorNewSessionDraftDocumentV1 | null {
  const parsed = NewSessionDraftDocumentV2Schema.safeParse(document);
  if (!parsed.success) return null;
  const executionTarget = parsed.data.target.authoring.executionTarget;
  const parsedExecutionTarget = executionTarget
    ? SessionAuthoringExecutionTargetV2Schema.nullable().safeParse(executionTarget.value)
    : null;
  if (parsedExecutionTarget && !parsedExecutionTarget.success) return null;
  const executionTargetValue = parsedExecutionTarget?.data ?? null;
  if (executionTargetValue?.kind === 'temporary_computer') return null;
  for (const [fieldId, field] of Object.entries(parsed.data.target.authoring)) {
    if (SUPPORTED_PREDECESSOR_SUCCESSOR_NEW_SESSION_FIELD_IDS.has(fieldId)) continue;
    const predecessorSchema = SyncedSessionAuthoringValueV1Schema.shape[
      fieldId as keyof typeof SyncedSessionAuthoringValueV1Schema.shape
    ];
    if (!predecessorSchema || !predecessorSchema.safeParse(field?.value).success) return null;
  }
  const projected = SupportedPredecessorNewSessionDraftDocumentV1Schema.safeParse({
    ...parsed.data,
    v: 1,
    target: {
      ...parsed.data.target,
      authoring: {
        ...parsed.data.target.authoring,
        ...(executionTarget ? {
          serverId: {
            mutationId: executionTarget.mutationId,
            value: executionTargetValue?.kind === 'machine'
              ? executionTargetValue.target.serverId
              : null,
          },
          machineId: {
            mutationId: executionTarget.mutationId,
            value: executionTargetValue?.kind === 'machine'
              ? executionTargetValue.target.machineId
              : null,
          },
        } : {}),
      },
    },
  });
  return projected.success ? projected.data : null;
}

export function createSupportedPredecessorNewSessionDraftPrivatePayloadV1(
  address: SessionDraftAddressV2,
  document: SessionDraftDocumentV2,
): SupportedPredecessorNewSessionDraftPrivatePayloadV1 | null {
  if (address.kind !== 'newSession') return null;
  const parsedDocument = NewSessionDraftDocumentV2Schema.safeParse(document);
  if (!parsedDocument.success) return null;
  const projected = projectNewSessionDraftDocumentToSupportedPredecessorV1(parsedDocument.data);
  if (!projected) return null;
  const parsedPayload = SupportedPredecessorNewSessionDraftPrivatePayloadV1Schema.safeParse({
    v: 1,
    address,
    document: projected,
  });
  return parsedPayload.success ? parsedPayload.data : null;
}

export const SessionDraftDocumentV2Schema = z.union([
  SessionDraftDocumentV1Schema,
  NewSessionDraftDocumentV2Schema,
  SessionDiscussionDraftDocumentV2Schema,
]);
export type SessionDraftDocumentV2 = z.infer<typeof SessionDraftDocumentV2Schema>;

/**
 * Current readers lift the supported bare exact-Machine V1 field into the
 * catalog's V2 target. Mutation identities and every other field are retained.
 */
export function normalizeSessionDraftDocumentV2(document: SessionDraftDocumentV2): SessionDraftDocumentV2 {
  // V1 is the released closed payload, so it never carries successor
  // `executionTarget` content to normalize. New targets are authored as V2 at
  // the repository boundary and stay unavailable to V1 readers.
  return document;
}

function readManualRecipientRunId(document: SessionDraftDocumentV1): string | null {
  if (document.target.kind !== 'session') return null;
  const recipient = SessionDraftRecipientValueV1Schema.safeParse(document.target.routing.recipient.value);
  if (!recipient.success || recipient.data === null || recipient.data.recipient === null) return null;
  try {
    const identity = normalizeParticipantRecipientRoutingIdentityV1(recipient.data.recipient);
    return identity.kind === 'execution_run' ? identity.runId : null;
  } catch {
    return null;
  }
}

const SessionDraftPrivatePayloadV2OnlySchema = z.object({
  v: z.literal(2),
  address: z.union([
    SessionDraftAddressV2OnlySchema,
    SessionDraftAddressV1Schema.options[0],
  ]),
  document: SessionDraftDocumentV2Schema,
}).strict().superRefine((payload, context) => {
  if (payload.address.kind === 'run') {
    if (payload.document.v === 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document', 'v'],
        message: 'A run draft carries the existing Session document shape',
      });
    } else if (readManualRecipientRunId(payload.document) !== payload.address.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document', 'target', 'routing', 'recipient'],
        message: 'A run draft must select its own run as the manual recipient',
      });
    }
  } else if (payload.document.v !== 2 || payload.document.target.kind !== payload.address.kind) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['document', 'target', 'kind'],
      message: 'Draft payload address and document target must agree',
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(payload)).byteLength
    > SESSION_DRAFT_MAX_PRIVATE_PAYLOAD_BYTES
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Draft private payload exceeds the supported boundary',
    });
  }
});

/**
 * V1 addresses keep their exact V1 payload envelope on the shared rows, so a V2
 * client editing a main Session draft cannot break its V1 sibling.
 */
export const SessionDraftPrivatePayloadV2Schema = z.union([
  SessionDraftPrivatePayloadV1Schema,
  SessionDraftPrivatePayloadV2OnlySchema,
]);
export type SessionDraftPrivatePayloadV2 = z.infer<typeof SessionDraftPrivatePayloadV2Schema>;

/**
 * Lifts the supported predecessor's V1 wrapper around preserved successor
 * new-Session fields back into the canonical V2 document. Known retired V1
 * display fields may be present after a predecessor edit; they are validated
 * but the preserved successor selection remains authoritative.
 */
export function restoreSupportedPredecessorNewSessionDraftPayloadV2(
  value: unknown,
): SessionDraftPrivatePayloadV2 | null {
  const parsedPredecessor = SupportedPredecessorNewSessionDraftPrivatePayloadV1Schema.safeParse(value);
  if (!parsedPredecessor.success) return null;
  const payload = parsedPredecessor.data;
  const document = payload.document;
  const targetRecord = document.target;
  const authoring = targetRecord.authoring;
  const restoredAuthoring: Record<string, unknown> = {};
  let hasPreservedSuccessorField = false;
  for (const [fieldId, field] of Object.entries(authoring)) {
    if (SUPPORTED_PREDECESSOR_SUCCESSOR_NEW_SESSION_FIELD_IDS.has(fieldId)) {
      hasPreservedSuccessorField = true;
      restoredAuthoring[fieldId] = field;
      continue;
    }
    // A predecessor edit can re-project its retired flat display fields beside
    // the preserved successor selection. Validate those bytes, then retain only
    // fields owned by the current V2 catalog; the preserved successor field is
    // the execution authority.
    if (Object.prototype.hasOwnProperty.call(SyncedSessionAuthoringValueV2Schema.shape, fieldId)) {
      restoredAuthoring[fieldId] = field;
    }
  }
  if (!hasPreservedSuccessorField) return null;
  const executionTarget = authoring.executionTarget;
  if (executionTarget) {
    const parsedExecutionTarget = DraftFieldV1Schema.safeParse(executionTarget);
    const parsedServerId = DraftFieldV1Schema.safeParse(authoring.serverId);
    const parsedMachineId = DraftFieldV1Schema.safeParse(authoring.machineId);
    if (!parsedExecutionTarget.success || !parsedServerId.success || !parsedMachineId.success) return null;
    const baseline = SyncedSessionAuthoringValueV2Schema.shape.executionTarget.safeParse(
      parsedExecutionTarget.data.value,
    );
    const serverId = SyncedSessionAuthoringValueV1Schema.shape.serverId.safeParse(parsedServerId.data.value);
    const machineId = SyncedSessionAuthoringValueV1Schema.shape.machineId.safeParse(parsedMachineId.data.value);
    if (!baseline.success || !serverId.success || !machineId.success || baseline.data?.kind === 'temporary_computer') {
      return null;
    }
    const baselineMutationId = parsedExecutionTarget.data.mutationId;
    const machineWasEdited = parsedMachineId.data.mutationId !== baselineMutationId;
    const serverWasEdited = parsedServerId.data.mutationId !== baselineMutationId;
    if (!machineWasEdited) {
      const expectedServerId = baseline.data?.kind === 'machine' ? baseline.data.target.serverId : null;
      const expectedMachineId = baseline.data?.kind === 'machine' ? baseline.data.target.machineId : null;
      if (serverWasEdited || serverId.data !== expectedServerId || machineId.data !== expectedMachineId) return null;
    } else if (machineId.data === null) {
      restoredAuthoring.executionTarget = {
        mutationId: parsedMachineId.data.mutationId,
        value: null,
      };
    } else {
      if (serverId.data === null) return null;
      const baselineServerId = baseline.data?.kind === 'machine' ? baseline.data.target.serverId : null;
      if (!serverWasEdited && serverId.data !== baselineServerId) return null;
      restoredAuthoring.executionTarget = {
        mutationId: parsedMachineId.data.mutationId,
        value: {
          kind: 'machine',
          target: { serverId: serverId.data, machineId: machineId.data },
        },
      };
    }
  } else if (authoring.serverId !== undefined || authoring.machineId !== undefined) {
    return null;
  }
  const candidate = {
    ...payload,
    v: 2,
    document: {
      ...document,
      v: 2,
      target: { ...targetRecord, authoring: restoredAuthoring },
    },
  };
  const parsed = SessionDraftPrivatePayloadV2Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * A lossless Machine-only projection retains ordinary V1 interoperability.
 * Successor fields, selection provenance and Temporary computer cannot be
 * dropped by this projection: the strict V1 parser instead selects V2.
 */
export function createSessionDraftPrivatePayloadV2(
  address: SessionDraftAddressV2,
  document: SessionDraftDocumentV2,
): SessionDraftPrivatePayloadV2 {
  return SessionDraftPrivatePayloadV2Schema.parse({
    v: isSessionDraftAddressV1(address) && document.v === 1 ? 1 : 2,
    address,
    document,
  });
}

export const SessionDraftStoredContentEnvelopeV2Schema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('plain'),
    v: z.union([
      SessionDraftPrivatePayloadV2Schema,
      SupportedPredecessorNewSessionDraftPrivatePayloadV1Schema,
    ]),
  }).strict(),
  z.object({
    t: z.literal('encrypted'),
    /** Visible content epoch protects opaque newSession rows from V1 writers. */
    v: z.literal(2).optional(),
    c: z.string().min(1).max(SESSION_DRAFT_MAX_CIPHERTEXT_LENGTH),
  }).strict(),
]);
export type SessionDraftStoredContentEnvelopeV2 = z.infer<typeof SessionDraftStoredContentEnvelopeV2Schema>;

/** Address membership alone cannot determine whether a newSession row is V1-readable. */
export function isSessionDraftContentV1(
  content: SessionDraftStoredContentEnvelopeV2 | null,
): boolean {
  return content === null || SessionDraftStoredContentEnvelopeV1Schema.safeParse(content).success;
}

/** Existing HTTP operation-update result; unaffected V1 drafts remain usable. */
export const SessionDraftEpochUnavailableResponseV2Schema = z.object({
  error: z.literal('session_draft_epoch_unavailable'),
}).strict();

export const SessionDraftRecordV2Schema = z.object({
  address: SessionDraftAddressV2Schema,
  revision: z.number().int().nonnegative(),
  content: SessionDraftStoredContentEnvelopeV2Schema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type SessionDraftRecordV2 = z.infer<typeof SessionDraftRecordV2Schema>;

export const SessionDraftReadRequestV2Schema = z.object({
  address: SessionDraftAddressV2Schema,
}).strict();
export type SessionDraftReadRequestV2 = z.infer<typeof SessionDraftReadRequestV2Schema>;
export const SessionDraftReadResponseV2Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('present'), record: SessionDraftRecordV2Schema }).strict(),
  z.object({ status: z.literal('deleted'), record: SessionDraftRecordV2Schema }).strict(),
  z.object({ status: z.literal('absent') }).strict(),
]);
export type SessionDraftReadResponseV2 = z.infer<typeof SessionDraftReadResponseV2Schema>;

export const SessionDraftAddressKindV2Schema = z.enum([
  'newSession',
  'session',
  'run',
  'discussion',
  'newDiscussion',
]);
export type SessionDraftAddressKindV2 = z.infer<typeof SessionDraftAddressKindV2Schema>;

export const SessionDraftListRequestV2Schema = z.object({
  after: CanonicalSessionDraftAddressV2Schema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  /** Query selector only; it is never the V1/V2 compatibility barrier. */
  addressKinds: z.array(SessionDraftAddressKindV2Schema).min(1).optional(),
}).strict();
export type SessionDraftListRequestV2 = z.infer<typeof SessionDraftListRequestV2Schema>;
export const SessionDraftListResponseV2Schema = z.object({
  items: z.array(SessionDraftRecordV2Schema),
  nextAfter: CanonicalSessionDraftAddressV2Schema.optional(),
}).strict();
export type SessionDraftListResponseV2 = z.infer<typeof SessionDraftListResponseV2Schema>;

export const SessionDraftMutateRequestV2Schema = z.object({
  address: SessionDraftAddressV2Schema,
  expectedRevision: SessionDraftExpectedRevisionV1Schema,
  content: SessionDraftStoredContentEnvelopeV2Schema.nullable(),
}).strict();
export type SessionDraftMutateRequestV2 = z.infer<typeof SessionDraftMutateRequestV2Schema>;
export const SessionDraftMutateResponseV2Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), record: SessionDraftRecordV2Schema }).strict(),
  z.object({
    status: z.literal('conflict'),
    current: z.union([
      SessionDraftRecordV2Schema,
      z.object({ status: z.literal('absent') }).strict(),
    ]),
  }).strict(),
]);
export type SessionDraftMutateResponseV2 = z.infer<typeof SessionDraftMutateResponseV2Schema>;

/**
 * Emitted only for V2-only addresses. Its discriminator cannot satisfy the
 * strict V1 hint schema, so a released V1 reader ignores it instead of feeding
 * an unknown address into a V1 draft handler.
 */
export const SessionDraftChangeHintV2Schema = z.object({
  v: z.literal(2),
  sessionDraftV2: z.literal(true),
  address: SessionDraftAddressV2Schema,
  revision: z.number().int().nonnegative(),
  status: z.enum(['present', 'deleted']),
}).strict();
export type SessionDraftChangeHintV2 = z.infer<typeof SessionDraftChangeHintV2Schema>;
export const SessionDraftSocketUpdateV2Schema = SessionDraftChangeHintV2Schema;
export type SessionDraftSocketUpdateV2 = SessionDraftChangeHintV2;
