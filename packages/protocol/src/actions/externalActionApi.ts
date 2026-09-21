import { z } from 'zod';
import { WorkflowProjectTargetV1Schema } from '../workflows/workflowWorkspaceV1.js';

import { RunnerMachineContentKeyBindingV1Schema } from '../ephemeralRunner/machineContentKeyBindingSchema.js';
import { MachineKindFromLegacyProjectionSchema } from '../machines/machineKind.js';

import {
  ActionExecuteFailureSchema,
  type ActionExecuteResult,
} from './actionExecutionResult.js';
import { StrictJsonValueSchema } from '../json/strictJsonValue.js';
import { getAccountScopedBlobCiphertextBase64LengthV1 } from '../crypto/accountScopedCipherEnvelope.js';
import {
  measurePluginJsonUtf8Bytes,
  measureSerializedValidatedStrictPluginJsonUtf8Bytes,
} from '../plugins/contributions/strictJsonValue.js';
import {
  EXTERNAL_ACTION_ACTION_ID_MAX_LENGTH,
  EXTERNAL_ACTION_REQUEST_ID_MAX_LENGTH_V1,
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  isExternalActionResultWithinResponseEnvelopeLimitV1,
  measureExternalActionResultResponseEnvelopeUtf8BytesV1,
} from './externalActionLimits.js';

export {
  EXTERNAL_ACTION_ACTION_ID_MAX_LENGTH,
  EXTERNAL_ACTION_REQUEST_ID_MAX_LENGTH_V1,
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  isExternalActionResultWithinResponseEnvelopeLimitV1,
  measureExternalActionResultResponseEnvelopeUtf8BytesV1,
};

/** Shared finite HTTP request ceiling for both public Action API origins. */
export const EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * Minimum Socket.IO capacity for a server-to-daemon Action request. This
 * leaves a 1 MiB carrier reserve above the admitted HTTP request body.
 */
export const EXTERNAL_ACTION_RELAY_REQUEST_SOCKET_MIN_BUFFER_BYTES = 33 * 1024 * 1024;

/** Minimum Socket.IO capacity for a daemon-to-server Action response. */
export const EXTERNAL_ACTION_RELAY_RESPONSE_SOCKET_MIN_BUFFER_BYTES = 25_000_000;

/** Relative path prefix; the Action id is the final path segment. */
export const EXTERNAL_ACTION_HTTP_PATH_PREFIX_V1 = '/v1/actions/' as const;

/**
 * The public path segment is an opaque identifier to the server relay. Its
 * finite scalar bound matches the other external Action identity fields while
 * admission remains exclusively with the target daemon's Action registry.
 */
export const ExternalActionActionIdV1Schema = z.string()
  .min(1)
  .max(EXTERNAL_ACTION_ACTION_ID_MAX_LENGTH)
  .refine((value) => value.trim() === value, 'actionId must not have outer whitespace');
export type ExternalActionActionIdV1 = z.infer<typeof ExternalActionActionIdV1Schema>;

export const ExternalActionRequestIdV1Schema = z.string()
  .min(1)
  .max(EXTERNAL_ACTION_REQUEST_ID_MAX_LENGTH_V1)
  .refine((value) => value.trim() === value, 'requestId must not have outer whitespace');

const EXTERNAL_ACTION_HTTP_ERROR_CODES_V1 = [
  'invalid_action',
  'invalid_envelope',
  'request_too_large',
  'internal_error',
  'invalid_encrypted_envelope',
  'encrypted_action_unsupported',
] as const;
const ExternalActionHttpErrorCodeV1Schema = z.enum(EXTERNAL_ACTION_HTTP_ERROR_CODES_V1);
export type ExternalActionHttpErrorCodeV1 = z.infer<typeof ExternalActionHttpErrorCodeV1Schema>;

const EXTERNAL_ACTION_HTTP_PLACEMENT_ERROR_CODES = [
  'target_required',
  'target_not_local',
  'target_unavailable',
  'session_input_target_update_required',
] as const;
const EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES = [
  'invalid_token',
  'auth_unavailable',
  'server_unavailable',
] as const;

/**
 * Complete bounded pre-open failure vocabulary. These values carry no Action
 * input, execution detail, target metadata, or daemon diagnostics.
 */
export const ExternalActionHttpErrorCodeSchema = z.enum([
  ...EXTERNAL_ACTION_HTTP_ERROR_CODES_V1,
  ...EXTERNAL_ACTION_HTTP_PLACEMENT_ERROR_CODES,
  ...EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES,
]);
export type ExternalActionHttpErrorCode = z.infer<typeof ExternalActionHttpErrorCodeSchema>;

/**
 * One bounded vocabulary for failures that occur before a protected Action
 * request has been opened. HTTP adapters and the reserved daemon relay project
 * the same codes; authentication-only failures remain at their HTTP boundary.
 */
export const ExternalActionPreOpenFailureCodeSchema = ExternalActionHttpErrorCodeSchema
  .exclude(EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES);
export type ExternalActionPreOpenFailureCode = z.infer<
  typeof ExternalActionPreOpenFailureCodeSchema
>;

/** Stable transport failures emitted before an Action execution envelope exists. */
export const ExternalActionHttpErrorV1Schema = z.object({
  error: z.literal('invalid_request'),
  code: ExternalActionHttpErrorCodeV1Schema,
}).strict();
export type ExternalActionHttpErrorV1 = z.infer<typeof ExternalActionHttpErrorV1Schema>;

const ExternalActionInvalidRequestHttpErrorSchema = z.object({
  error: z.literal('invalid_request'),
  code: ExternalActionPreOpenFailureCodeSchema,
  requestId: ExternalActionRequestIdV1Schema.optional(),
}).strict();

const ExternalActionAuthenticationHttpErrorSchema = z.object({
  error: z.enum(EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES),
}).strict();

/** One strict redacted outer error union shared by both Action HTTP origins. */
export const ExternalActionHttpErrorSchema = z.union([
  ExternalActionInvalidRequestHttpErrorSchema,
  ExternalActionAuthenticationHttpErrorSchema,
]);
export type ExternalActionHttpError = z.infer<typeof ExternalActionHttpErrorSchema>;

function isExternalActionHttpAuthenticationErrorCode(
  code: ExternalActionHttpErrorCode,
): code is typeof EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES[number] {
  return EXTERNAL_ACTION_HTTP_AUTHENTICATION_ERROR_CODES.some((candidate) => candidate === code);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The one transport-neutral projection from internal Action execution into
 * the public external Action result. Internal contributors may retain richer
 * diagnostics; neither HTTP origin can disclose them as top-level fields.
 */
export function projectExternalActionExecutionResultV1(value: unknown): ActionExecuteResult | null {
  const result = readRecord(value);
  if (!result) return null;

  if (result.ok === true && Object.prototype.hasOwnProperty.call(result, 'result')) {
    return { ok: true, result: result.result };
  }
  if (result.ok !== false) return null;

  const failure = ActionExecuteFailureSchema.safeParse({
    ok: false,
    errorCode: result.errorCode,
    error: result.error,
    ...(Object.prototype.hasOwnProperty.call(result, 'details')
      ? { details: result.details }
      : {}),
  });
  return failure.success ? failure.data : null;
}

/** Maps a protocol transport failure to its complete HTTP representation. */
function externalActionHttpErrorStatus(code: ExternalActionHttpErrorCode): 400 | 401 | 409 | 413 | 500 | 503 {
  if (code === 'invalid_token') return 401;
  if (code === 'auth_unavailable' || code === 'server_unavailable') return 503;
  if (code === 'request_too_large') return 413;
  if (code === 'internal_error') return 500;
  if (
    code === 'encrypted_action_unsupported'
    || code === 'target_not_local'
    || code === 'target_unavailable'
    || code === 'session_input_target_update_required'
  ) return 409;
  return 400;
}

export function projectExternalActionHttpErrorV1(code: ExternalActionHttpErrorCodeV1): Readonly<{
  statusCode: 400 | 409 | 413 | 500;
  payload: ExternalActionHttpErrorV1;
}> {
  return {
    statusCode: externalActionHttpErrorStatus(code) as 400 | 409 | 413 | 500,
    payload: { error: 'invalid_request', code },
  };
}

/** Maps a bounded pre-open failure to its complete redacted HTTP representation. */
export function projectExternalActionHttpError(
  code: ExternalActionHttpErrorCode,
  requestId?: string,
): Readonly<{
  statusCode: 400 | 401 | 409 | 413 | 500 | 503;
  payload: ExternalActionHttpError;
}> {
  return isExternalActionHttpAuthenticationErrorCode(code)
    ? { statusCode: externalActionHttpErrorStatus(code), payload: { error: code } }
    : {
        statusCode: externalActionHttpErrorStatus(code),
        payload: {
          error: 'invalid_request',
          code,
          ...(requestId === undefined ? {} : { requestId }),
        },
      };
}

/** Closed server-to-exact-daemon method; never a public Action or SDK method. */
export const EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1 =
  'daemon.actions.external.dispatch' as const;

/**
 * Recovers only safe correlation from a purported protected outer frame. It
 * deliberately does not classify the frame as valid or expose any other key.
 */
export function readExternalActionProtectedRequestId(value: unknown): string | undefined {
  const record = readRecord(value);
  if (record?.v !== 2) return undefined;
  const requestId = ExternalActionRequestIdV1Schema.safeParse(record.requestId);
  return requestId.success ? requestId.data : undefined;
}

const ExternalActionExecutionSuccessV1Schema = z.object({
  ok: z.literal(true),
  result: z.unknown(),
}).strict().superRefine((value, context) => {
  if (!Object.prototype.hasOwnProperty.call(value, 'result')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'result is required',
    });
  }
});

/** Closed public execution union. Bridge-private execution metadata cannot cross it. */
export const ExternalActionExecutionResultV1Schema = z.union([
  ExternalActionExecutionSuccessV1Schema,
  ActionExecuteFailureSchema,
]);

const EXTERNAL_ACTION_RESULT_TOO_LARGE_MESSAGE =
  'Action execution completed, but its response exceeded the external Action response limit and could not be represented.' as const;

/** Strict admitted result used only after the Action has completed. */
export const ExternalActionResultTooLargeExecutionV1Schema = z.object({
  ok: z.literal(false),
  errorCode: z.literal('result_too_large'),
  error: z.literal(EXTERNAL_ACTION_RESULT_TOO_LARGE_MESSAGE),
  details: z.object({
    executionCompleted: z.literal(true),
    maxSerializedBytes: z.literal(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES),
  }).strict(),
}).strict();
export type ExternalActionResultTooLargeExecutionV1 = Readonly<z.infer<
  typeof ExternalActionResultTooLargeExecutionV1Schema
>>;

export function createExternalActionResultTooLargeExecutionV1(): ExternalActionResultTooLargeExecutionV1 {
  return {
    ok: false,
    errorCode: 'result_too_large',
    error: EXTERNAL_ACTION_RESULT_TOO_LARGE_MESSAGE,
    details: {
      executionCompleted: true,
      maxSerializedBytes: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
    },
  };
}

/**
 * Strict public external Action response. Both HTTP origins and the SDK use
 * this one envelope; Action-domain failures stay inside `execution`.
 */
export const ExternalActionResponseEnvelopeV1Schema = z.object({
  v: z.literal(1),
  actionId: ExternalActionActionIdV1Schema,
  requestId: ExternalActionRequestIdV1Schema.optional(),
  execution: ExternalActionExecutionResultV1Schema,
}).strict();

/**
 * Strict outer relay framing. The relay may receive a daemon execution result
 * with private metadata, but never gains a second public response envelope.
 */
const ExternalActionResponseEnvelopeV1ProjectionInputSchema = z.object({
  v: z.literal(1),
  actionId: ExternalActionActionIdV1Schema,
  requestId: ExternalActionRequestIdV1Schema.optional(),
  execution: z.unknown(),
}).strict().superRefine((value, context) => {
  if (!Object.prototype.hasOwnProperty.call(value, 'execution')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['execution'],
      message: 'execution is required',
    });
  }
});

/** Stable finite response envelope shared by the daemon and server adapters. */
export type ExternalActionResponseEnvelopeV1 = Readonly<{
  v: 1;
  actionId: ExternalActionActionIdV1;
  requestId?: string;
  execution: ActionExecuteResult;
}>;

/**
 * The one strict JSON response projection prepared after external Action
 * execution. Same-process HTTP adapters send these bytes directly; the
 * reserved daemon relay carries a binary projection of these exact bytes.
 */
export type PreparedExternalActionResponseEnvelopeV1 = Readonly<{
  response: ExternalActionResponseEnvelopeV1;
  body: string;
  byteLength: number;
}>;

/**
 * Projects an exact-daemon relay result onto the one strict public response
 * union. Only execution metadata is normalized; relay envelope fields remain
 * closed and are never rewritten by a transport adapter.
 */
export function projectExternalActionResponseEnvelopeV1(
  value: unknown,
): ExternalActionResponseEnvelopeV1 | null {
  const parsed = ExternalActionResponseEnvelopeV1ProjectionInputSchema.safeParse(value);
  if (!parsed.success) return null;
  const execution = projectExternalActionExecutionResultV1(parsed.data.execution);
  if (!execution) return null;
  return {
    v: 1,
    actionId: parsed.data.actionId,
    ...(parsed.data.requestId === undefined ? {} : { requestId: parsed.data.requestId }),
    execution,
  };
}

/**
 * Reads the strict public response shape and returns the canonical Action
 * execution projection. Consumers never need a hand-written response parser.
 */
export function parseExternalActionResponseEnvelopeV1(
  value: unknown,
): ExternalActionResponseEnvelopeV1 | null {
  const parsed = ExternalActionResponseEnvelopeV1Schema.safeParse(value);
  if (!parsed.success) return null;
  const execution = projectExternalActionExecutionResultV1(parsed.data.execution);
  if (!execution) return null;
  return {
    v: 1,
    actionId: parsed.data.actionId,
    ...(parsed.data.requestId === undefined ? {} : { requestId: parsed.data.requestId }),
    execution,
  };
}

const ExternalActionDaemonDispatchInvalidRequestCodeV1Schema = z.enum([
  'invalid_action',
  'invalid_envelope',
]);
export type ExternalActionDaemonDispatchInvalidRequestCodeV1 = z.infer<
  typeof ExternalActionDaemonDispatchInvalidRequestCodeV1Schema
>;

const ExternalActionDaemonDispatchInvalidRequestV1Schema = z.object({
  kind: z.literal('invalid_request'),
  errorCode: ExternalActionDaemonDispatchInvalidRequestCodeV1Schema,
}).strict();

/**
 * Socket.IO carries the already-prepared public response as a binary
 * attachment. A JSON string would need another escaping pass in the Socket.IO
 * frame and could exceed the one-megabyte response-carrier reserve.
 */
const ExternalActionDaemonDispatchPreparedBodyV1Schema = z.instanceof(Uint8Array)
  .refine(
    (value) => value.byteLength <= EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
    `external Action relay response must not exceed ${EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES} bytes`,
  );

/**
 * Closed result of the reserved server-to-daemon Action relay. Admission
 * failures remain transport failures; only a completed/admitted Action may
 * carry the already-serialized strict public response bytes.
 */
export const ExternalActionDaemonDispatchResultV1Schema = z.discriminatedUnion('kind', [
  ExternalActionDaemonDispatchInvalidRequestV1Schema,
  z.object({
    kind: z.literal('response'),
    body: ExternalActionDaemonDispatchPreparedBodyV1Schema,
  }).strict(),
]);
export type ExternalActionDaemonDispatchResultV1 = Readonly<
  | {
    kind: 'invalid_request';
    errorCode: ExternalActionDaemonDispatchInvalidRequestCodeV1;
  }
  | {
    kind: 'response';
    body: Uint8Array;
  }
>;

/** Parsed relay result; the prepared body is never re-projected or remeasured. */
export type ParsedExternalActionDaemonDispatchResultV1 = Readonly<
  | {
    kind: 'invalid_request';
    errorCode: ExternalActionDaemonDispatchInvalidRequestCodeV1;
  }
  | {
    kind: 'response';
    prepared: PreparedExternalActionResponseEnvelopeV1;
  }
>;

/**
 * Projects the canonical prepared body onto the existing closed reserved-RPC
 * response wrapper. The payload is binary so Socket.IO does not quote/escape
 * the already-serialized JSON a second time.
 */
export function createExternalActionDaemonDispatchResponseV1(
  prepared: PreparedExternalActionResponseEnvelopeV1,
): Extract<ExternalActionDaemonDispatchResultV1, Readonly<{ kind: 'response' }>> {
  const body = new TextEncoder().encode(prepared.body);
  if (body.byteLength !== prepared.byteLength) {
    throw new TypeError('External Action prepared response byte length mismatch');
  }
  return { kind: 'response', body };
}

function parsePreparedExternalActionResponseBodyV1(
  value: Uint8Array,
): PreparedExternalActionResponseEnvelopeV1 | null {
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const response = parseExternalActionResponseEnvelopeV1(raw);
  return response
    ? { response, body, byteLength: value.byteLength }
    : null;
}

/** Reads a strict reserved relay result without retaining daemon-private fields. */
export function parseExternalActionDaemonDispatchResultV1(
  value: unknown,
): ParsedExternalActionDaemonDispatchResultV1 | null {
  const parsed = ExternalActionDaemonDispatchResultV1Schema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.kind === 'invalid_request') {
    return {
      kind: 'invalid_request',
      errorCode: parsed.data.errorCode,
    };
  }
  const prepared = parsePreparedExternalActionResponseBodyV1(parsed.data.body);
  return prepared ? { kind: 'response', prepared } : null;
}

function measureSerializedUtf8Bytes(
  value: ExternalActionResponseEnvelopeV1,
  maximumBytes?: number,
): number {
  return measureSerializedValidatedStrictPluginJsonUtf8Bytes(
    value,
    'externalActionResponse',
    maximumBytes,
  );
}

function projectStrictJsonExternalActionResponseEnvelopeV1(
  response: ExternalActionResponseEnvelopeV1,
): ExternalActionResponseEnvelopeV1 | null {
  // JSON.stringify omits undefined/function/symbol object members and emits
  // null for those values in arrays. Apply that native projection before the
  // strict-data validation so an otherwise valid Action result is not turned
  // into invalid_action_output merely because it contains an optional field.
  const omitted = Symbol('omitted');
  const invalid = Symbol('invalid');
  const project = (value: unknown, ancestors: Set<object>, depth = 0): unknown => {
    // Keep the projection itself stack-safe; the response will be replaced
    // with invalid_action_output rather than allowing a deeply nested result
    // to overflow the process before the existing serializer guard runs.
    if (depth > 1_000) return invalid;
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return omitted;
    if (value === null || typeof value !== 'object') return value;
    if (ancestors.has(value)) return invalid;
    const nextAncestors = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
      return value.map((item) => {
        const projected = project(item, nextAncestors, depth + 1);
        return projected === omitted ? null : projected;
      });
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Accessors are not JSON data and must not be invoked at this boundary.
      if (!descriptor || !('value' in descriptor)) return invalid;
      const projected = project(descriptor.value, nextAncestors, depth + 1);
      if (projected !== omitted) output[key] = projected;
    }
    return output;
  };
  const projected = project(response, new Set());
  const strictJson = projected === invalid
    ? { success: false as const }
    : StrictJsonValueSchema.safeParse(projected);
  return strictJson.success
    ? parseExternalActionResponseEnvelopeV1(strictJson.data)
    : null;
}

function invalidActionOutputResponse(
  response: ExternalActionResponseEnvelopeV1,
): ExternalActionResponseEnvelopeV1 {
  return {
    v: 1,
    actionId: response.actionId,
    ...(response.requestId === undefined ? {} : { requestId: response.requestId }),
    execution: {
      ok: false,
      errorCode: 'invalid_action_output',
      error: 'invalid_action_output',
    },
  };
}

/** Measures exactly the strict JSON envelope that an external transport sends. */
export function measureExternalActionResponseEnvelopeUtf8BytesV1(value: unknown): number {
  const parsed = parseExternalActionResponseEnvelopeV1(value);
  const strictJson = parsed && StrictJsonValueSchema.safeParse(parsed);
  const response = strictJson?.success ? parseExternalActionResponseEnvelopeV1(strictJson.data) : null;
  if (!response) {
    throw new TypeError('External Action response envelope must contain strict JSON data');
  }
  return measureSerializedUtf8Bytes(response);
}

/**
 * Applies the one response ceiling and native JSON representability check
 * after Action execution. Both public entry points consume this one prepared
 * projection rather than owning separate response serializers.
 */
export function prepareExternalActionResponseEnvelopeV1(
  value: unknown,
): PreparedExternalActionResponseEnvelopeV1 {
  const response = parseExternalActionResponseEnvelopeV1(value);
  if (!response) {
    throw new TypeError('Invalid external Action response envelope');
  }
  const strictJsonResponse = projectStrictJsonExternalActionResponseEnvelopeV1(response);
  let candidate: ExternalActionResponseEnvelopeV1;
  if (!strictJsonResponse) {
    candidate = invalidActionOutputResponse(response);
  } else if (
    measureSerializedUtf8Bytes(
      strictJsonResponse,
      EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
    ) > EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES
  ) {
    candidate = {
      v: 1,
      actionId: strictJsonResponse.actionId,
      ...(strictJsonResponse.requestId === undefined ? {} : { requestId: strictJsonResponse.requestId }),
      execution: createExternalActionResultTooLargeExecutionV1(),
    };
  } else {
    candidate = strictJsonResponse;
  }

  let body: string | undefined;
  try {
    body = JSON.stringify(candidate);
  } catch {
    // Supported engines do not agree on JSON nesting depth. This is not a
    // size policy, so preserve the existing permanent Action-output failure.
    const invalidActionOutput = invalidActionOutputResponse(candidate);
    const invalidActionOutputBody = JSON.stringify(invalidActionOutput);
    if (invalidActionOutputBody === undefined) {
      throw new TypeError('External Action response envelope must serialize to JSON');
    }
    return {
      response: invalidActionOutput,
      body: invalidActionOutputBody,
      byteLength: measurePluginJsonUtf8Bytes(invalidActionOutputBody, 'externalActionResponse'),
    };
  }
  if (body === undefined) {
    throw new TypeError('External Action response envelope must serialize to JSON');
  }
  return {
    response: candidate,
    body,
    byteLength: measurePluginJsonUtf8Bytes(body, 'externalActionResponse'),
  };
}

/**
 * Applies the one response ceiling after Action execution. Oversize output is
 * replaced with a small admitted result while retaining request correlation.
 */
export function enforceExternalActionResponseEnvelopeLimitV1(
  value: unknown,
): ExternalActionResponseEnvelopeV1 {
  return prepareExternalActionResponseEnvelopeV1(value).response;
}

/**
 * The one native JSON body projection for a public Action response. Both
 * Fastify origins consume this pre-serialized representation so a valid
 * Protocol value cannot reach one adapter only to fail during serialization.
 */
export function serializeExternalActionResponseEnvelopeV1(value: unknown): Readonly<{
  body: string;
  byteLength: number;
}> {
  const prepared = prepareExternalActionResponseEnvelopeV1(value);
  return {
    body: prepared.body,
    byteLength: prepared.byteLength,
  };
}

const ExternalActionTargetIdV1Schema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value, 'target id must not have outer whitespace');

/**
 * Closed Account-server bootstrap projection used only to select an exact
 * Machine for a subsequent external Action request.
 *
 * Persistent-Machine content and daemon/install state deliberately do not
 * cross this PAT-authenticated seam. A restricted Runner carries exactly the
 * facts a protected request must seal against — its kind, its winning
 * installation, its Account-sealed content-key envelope and the strict
 * non-secret binding that authenticates it. All four are already
 * Account-material-protected: the envelope is a sealed box only an Account
 * content key opens, and the binding carries no secret. A bearer-only token
 * therefore learns nothing it can use, and an encryption-capable credential
 * reaches the same verifier every other authorized Account device reaches.
 */
export const ExternalActionMachineBootstrapV1Schema = z.object({
  id: ExternalActionTargetIdV1Schema,
  active: z.boolean(),
  revokedAt: z.number().int().nonnegative().nullable(),
  replacedByMachineId: ExternalActionTargetIdV1Schema.nullable(),
  kind: MachineKindFromLegacyProjectionSchema,
  /** Runner only; a persistent Machine keeps the released closed projection. */
  installationId: z.string().trim().min(1).nullable().default(null),
  dataEncryptionKey: z.string().min(1).nullable().default(null),
  runnerContentKeyBinding: RunnerMachineContentKeyBindingV1Schema.nullable().default(null),
}).strict();
export type ExternalActionMachineBootstrapV1 = z.infer<
  typeof ExternalActionMachineBootstrapV1Schema
>;

export const ExternalActionMachineBootstrapListV1Schema = z.array(
  ExternalActionMachineBootstrapV1Schema,
);
export type ExternalActionMachineBootstrapListV1 = z.infer<
  typeof ExternalActionMachineBootstrapListV1Schema
>;

/**
 * Target selection is transport metadata only. It never becomes Action input,
 * caller provenance, approval state, or a contributor-generation assertion.
 */
export const ExternalActionTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('machine'),
    machineId: ExternalActionTargetIdV1Schema,
    /** Optional machine-local project target, cryptographically bound as transport metadata. */
    project: WorkflowProjectTargetV1Schema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.project && value.project.machineId !== value.machineId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project', 'machineId'],
        message: 'project target must match machineId',
      });
    }
  }),
  z.object({
    kind: z.literal('session'),
    sessionId: ExternalActionTargetIdV1Schema,
  }).strict(),
]);
export type ExternalActionTargetV1 = z.infer<typeof ExternalActionTargetV1Schema>;

/** One strict equality owner for cryptographically bound external Action targets. */
export function externalActionTargetsEqualV1(
  left: ExternalActionTargetV1,
  right: ExternalActionTargetV1,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'session') {
    return right.kind === 'session' && left.sessionId === right.sessionId;
  }
  if (right.kind !== 'machine' || left.machineId !== right.machineId) return false;
  if (!left.project || !right.project) return left.project === right.project;
  return left.project.machineId === right.project.machineId
    && left.project.directory === right.project.directory
    && left.project.workspaceRefId === right.project.workspaceRefId;
}

/**
 * A Home authorizes one exact outer target and one selected relay Machine.
 * That Machine may resolve its own outer Machine target to an exact Session,
 * but it may not substitute another Machine or mutate a project target.
 */
export function isExternalActionResolvedTargetAllowedV1(input: Readonly<{
  authorizedTarget: ExternalActionTargetV1;
  resolvedTarget: ExternalActionTargetV1;
  selectedMachineId: string;
}>): boolean {
  if (input.authorizedTarget.kind === 'session') {
    return externalActionTargetsEqualV1(input.authorizedTarget, input.resolvedTarget);
  }
  if (input.authorizedTarget.machineId !== input.selectedMachineId) return false;
  return input.resolvedTarget.kind === 'session'
    || externalActionTargetsEqualV1(input.authorizedTarget, input.resolvedTarget);
}

/**
 * Public Action HTTP request envelope. Execution context is deliberately
 * absent: each ingress verifies credentials and stamps authority, provenance,
 * cancellation, and placement after this parser succeeds.
 */
export const ExternalActionRequestEnvelopeV1Schema = z.object({
  v: z.literal(1),
  requestId: ExternalActionRequestIdV1Schema.optional(),
  target: ExternalActionTargetV1Schema.optional(),
  input: StrictJsonValueSchema,
}).strict().superRefine((value, context) => {
  if (!Object.prototype.hasOwnProperty.call(value, 'input')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['input'],
      message: 'input is required',
    });
  }
});
export type ExternalActionRequestEnvelopeV1 = z.infer<
  typeof ExternalActionRequestEnvelopeV1Schema
>;

// Six bytes per code unit covers JSON escaping, including control characters.
// These small values model only fields with an actual scalar bound. The target
// and input already share the complete V1 request-byte ceiling and must never
// be materialized independently to calculate a transport reserve.
const maximumBindingId = '\u0000'.repeat(256);
const maximumRequestId = '\u0000'.repeat(EXTERNAL_ACTION_REQUEST_ID_MAX_LENGTH_V1);
const maximumServerIdentityId = `srv_${'s'.repeat(60)}`;
const maximumCredentialId = '00000000-0000-4000-8000-000000000000';
const maximumRequestPayloadDigest = 'x'.repeat(43);
const jsonNullBytes = 4;

function measureJsonUtf8Bytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('External Action framing must serialize to JSON');
  return new TextEncoder().encode(serialized).byteLength;
}

const maximumV1RequestSkeletonBytes = measureJsonUtf8Bytes({
  v: 1, requestId: maximumRequestId, target: null, input: null,
});
const maximumEncryptedRequestSkeletonBytes = measureJsonUtf8Bytes({
  v: 2, direction: 'request', serverIdentityId: maximumServerIdentityId,
  accountId: maximumBindingId, credentialId: maximumCredentialId,
  actionId: maximumBindingId, requestId: maximumRequestId,
  target: null, input: null,
});

/** Largest encrypted plaintext produced from one complete valid V1 request. */
export const EXTERNAL_ACTION_ENCRYPTED_REQUEST_PLAINTEXT_MAX_BYTES_V2 =
  EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES
  + maximumEncryptedRequestSkeletonBytes
  - maximumV1RequestSkeletonBytes;

const maximumV1ResponseSkeletonBytes = measureJsonUtf8Bytes({
  v: 1, actionId: maximumBindingId, requestId: maximumRequestId, execution: null,
});
const maximumEncryptedResponseSkeletonBytes = measureJsonUtf8Bytes({
  v: 2, direction: 'response', serverIdentityId: maximumServerIdentityId,
  accountId: maximumBindingId, credentialId: maximumCredentialId,
  actionId: maximumBindingId, requestId: maximumRequestId,
  target: null, executedMachineId: maximumBindingId,
  requestPayloadDigest: maximumRequestPayloadDigest, execution: null,
});

/**
 * Largest encrypted response plaintext. Its execution retains the complete V1
 * response budget and its authenticated target is bounded by the complete V1
 * request envelope that produced the response.
 */
export const EXTERNAL_ACTION_ENCRYPTED_RESPONSE_PLAINTEXT_MAX_BYTES_V2 =
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES
  + maximumEncryptedResponseSkeletonBytes
  - maximumV1ResponseSkeletonBytes
  - jsonNullBytes
  + EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES;

const maximumRequestOuterFixedBytes = measureJsonUtf8Bytes({
  v: 2, requestId: maximumRequestId, target: null,
  payload: { t: 'encrypted', c: '' },
}) - jsonNullBytes;
const maximumResponseOuterFixedBytes = measureJsonUtf8Bytes({
  v: 2, actionId: maximumBindingId, requestId: maximumRequestId,
  payload: { t: 'encrypted', c: '' },
});

export const EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2 =
  maximumRequestOuterFixedBytes
  + getAccountScopedBlobCiphertextBase64LengthV1(
    EXTERNAL_ACTION_ENCRYPTED_REQUEST_PLAINTEXT_MAX_BYTES_V2,
  );
export const EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES_V2 =
  maximumResponseOuterFixedBytes
  + getAccountScopedBlobCiphertextBase64LengthV1(
    EXTERNAL_ACTION_ENCRYPTED_RESPONSE_PLAINTEXT_MAX_BYTES_V2,
  );
export const EXTERNAL_ACTION_RELAY_REQUEST_SOCKET_MIN_BUFFER_BYTES_V2 = EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2
  + (EXTERNAL_ACTION_RELAY_REQUEST_SOCKET_MIN_BUFFER_BYTES - EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES);
export const EXTERNAL_ACTION_RELAY_RESPONSE_SOCKET_MIN_BUFFER_BYTES_V2 = EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES_V2
  + (EXTERNAL_ACTION_RELAY_RESPONSE_SOCKET_MIN_BUFFER_BYTES - EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES);

/** V2 is closed at every routing and encryption boundary; content is opaque. */
export const ExternalActionRequestEnvelopeV2Schema = z.object({
  v: z.literal(2), requestId: ExternalActionRequestIdV1Schema,
  target: ExternalActionTargetV1Schema.optional(),
  payload: z.object({ t: z.literal('encrypted'), c: z.string().min(1).max(EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2) }).strict(),
}).strict();
export type ExternalActionRequestEnvelopeV2 = z.infer<typeof ExternalActionRequestEnvelopeV2Schema>;
export const ExternalActionRequestEnvelopeSchema = z.union([
  ExternalActionRequestEnvelopeV1Schema, ExternalActionRequestEnvelopeV2Schema,
]);
export type ExternalActionRequestEnvelope = z.infer<typeof ExternalActionRequestEnvelopeSchema>;
export const ExternalActionResponseEnvelopeV2Schema = z.object({
  v: z.literal(2), actionId: ExternalActionActionIdV1Schema, requestId: ExternalActionRequestIdV1Schema,
  payload: z.object({ t: z.literal('encrypted'), c: z.string().min(1).max(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES_V2) }).strict(),
}).strict();
export type ExternalActionResponseEnvelopeV2 = z.infer<typeof ExternalActionResponseEnvelopeV2Schema>;
export type PreparedExternalActionResponseEnvelope = Readonly<{
  response: ExternalActionResponseEnvelopeV1 | ExternalActionResponseEnvelopeV2;
  body: string;
  byteLength: number;
}>;

/** Version-specific ceilings retain the V1 decoded-content contract. */
export function isExternalActionRequestWithinLimit(envelope: ExternalActionRequestEnvelope): boolean {
  return measurePluginJsonUtf8Bytes(JSON.stringify(envelope), 'externalActionRequest') <= (
    envelope.v === 1 ? EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES : EXTERNAL_ACTION_HTTP_BODY_LIMIT_BYTES_V2
  );
}

const ExternalActionServerPrincipalIdV1Schema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value, 'principal identifiers must not have outer whitespace');

/** Server-stamped PAT provenance; it is never accepted in the public envelope. */
export const ExternalActionServerPrincipalV1Schema = z.object({
  accountId: ExternalActionServerPrincipalIdV1Schema,
  principalId: ExternalActionServerPrincipalIdV1Schema,
  credentialId: ExternalActionServerPrincipalIdV1Schema,
  authority: z.literal('account_automation'),
}).strict();
export type ExternalActionServerPrincipalV1 = z.infer<typeof ExternalActionServerPrincipalV1Schema>;

/** Home-authenticated invocation facts. The selected daemon owns plaintext transformation. */
export const ExternalActionExecutionAuthorizationBindingV1Schema = ExternalActionServerPrincipalV1Schema
  .omit({ authority: true }).extend({
    serverIdentityId: ExternalActionServerPrincipalIdV1Schema,
    machineId: ExternalActionTargetIdV1Schema,
    actionId: ExternalActionActionIdV1Schema,
    requestId: ExternalActionRequestIdV1Schema,
    requestEnvelopeDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    target: ExternalActionTargetV1Schema,
  }).strict();
export type ExternalActionExecutionAuthorizationBindingV1 = z.infer<typeof ExternalActionExecutionAuthorizationBindingV1Schema>;

/** Authorization material: usable only together with the selected Machine's request signature. */
export const ExternalActionExecutionAuthorizationV1Schema = z.object({
  v: z.literal(1),
  token: z.string().min(1),
  binding: ExternalActionExecutionAuthorizationBindingV1Schema,
}).strict();
export type ExternalActionExecutionAuthorizationV1 = z.infer<typeof ExternalActionExecutionAuthorizationV1Schema>;

/** Optional authenticated auxiliary arm of the incumbent socket RPC request. */
export const ExternalActionMachineRpcExecutionV1Schema = z.object({
  v: z.literal(1),
  authorization: ExternalActionExecutionAuthorizationV1Schema,
  effectActionId: ExternalActionActionIdV1Schema,
  target: ExternalActionTargetV1Schema,
  installationId: z.string().trim().min(1),
  machineSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
}).strict();
export type ExternalActionMachineRpcExecutionV1 = z.infer<typeof ExternalActionMachineRpcExecutionV1Schema>;

export const EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER = 'x-happier-action-execution-authorization';
export const EXTERNAL_ACTION_MACHINE_SIGNATURE_HEADER = 'x-happier-action-machine-signature';
export const EXTERNAL_ACTION_EFFECT_ACTION_HEADER = 'x-happier-action-effect';
export const EXTERNAL_ACTION_RESOLVED_TARGET_HEADER = 'x-happier-action-target';
export const EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HTTP_PATH_TEMPLATE_V1 = '/v1/actions/:actionId/execution-authorization';
export const EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_VERIFY_HTTP_PATH_TEMPLATE_V1 = '/v1/actions/:actionId/execution-authorization/verify';
export function bindExternalActionExecutionAuthorizationHttpPathV1(actionId: string): string {
  return `/v1/actions/${encodeURIComponent(ExternalActionActionIdV1Schema.parse(actionId))}/execution-authorization`;
}
export function bindExternalActionExecutionAuthorizationVerifyHttpPathV1(actionId: string): string {
  return `${bindExternalActionExecutionAuthorizationHttpPathV1(actionId)}/verify`;
}
export const ExternalActionExecutionAuthorizationRequestV1Schema = z.object({
  v: z.literal(1), machineId: ExternalActionTargetIdV1Schema, envelope: ExternalActionRequestEnvelopeSchema,
}).strict();
export type ExternalActionExecutionAuthorizationRequestV1 = z.infer<typeof ExternalActionExecutionAuthorizationRequestV1Schema>;
export const ExternalActionExecutionAuthorizationVerifyRequestV1Schema = z.object({ v: z.literal(1) }).strict();
export const ExternalActionExecutionAuthorizationVerifyResponseV1Schema = z.object({ ok: z.literal(true) }).strict();

/** Exact server-held placement facts for the closed daemon dispatch. */
export const ExternalActionDaemonPlacementV1Schema = z.object({
  machineId: ExternalActionTargetIdV1Schema,
  target: z.object({
    kind: z.literal('machine'),
    machineId: ExternalActionTargetIdV1Schema,
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.machineId !== value.target.machineId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target', 'machineId'],
      message: 'placement target must match machineId',
    });
  }
});
export type ExternalActionDaemonPlacementV1 = z.infer<typeof ExternalActionDaemonPlacementV1Schema>;

/** Closed server-to-daemon Action dispatch framing. */
export const ExternalActionDaemonDispatchRequestV1Schema = z.object({
  // The relay proves only closed framing, provenance, and placement. The
  // target daemon is the sole Action-id admission owner.
  actionId: ExternalActionActionIdV1Schema,
  envelope: ExternalActionRequestEnvelopeV1Schema,
  principal: ExternalActionServerPrincipalV1Schema,
  placement: ExternalActionDaemonPlacementV1Schema,
}).strict();
export type ExternalActionDaemonDispatchRequestV1 = z.infer<
  typeof ExternalActionDaemonDispatchRequestV1Schema
>;

export const ExternalActionDaemonDispatchRequestSchema = ExternalActionDaemonDispatchRequestV1Schema.extend({
  envelope: ExternalActionRequestEnvelopeSchema,
  executionAuthorization: ExternalActionExecutionAuthorizationV1Schema.optional(),
}).strict();
export type ExternalActionDaemonDispatchRequest = z.infer<typeof ExternalActionDaemonDispatchRequestSchema>;

const ExternalActionDaemonDispatchInvalidRequestSchema = ExternalActionDaemonDispatchInvalidRequestV1Schema.extend({
  errorCode: ExternalActionPreOpenFailureCodeSchema,
  requestId: ExternalActionRequestIdV1Schema.optional(),
}).strict();

export type ParsedExternalActionDaemonDispatchResult = Readonly<
  | z.infer<typeof ExternalActionDaemonDispatchInvalidRequestSchema>
  | { kind: 'response'; prepared: PreparedExternalActionResponseEnvelope }
>;

/** Same reserved binary carrier; each decoded body retains its own version ceiling. */
export function createExternalActionDaemonDispatchResponse(prepared: PreparedExternalActionResponseEnvelope): Readonly<{
  kind: 'response'; body: Uint8Array;
}> {
  const body = new TextEncoder().encode(prepared.body);
  if (body.byteLength !== prepared.byteLength) throw new TypeError('External Action prepared response byte length mismatch');
  return { kind: 'response', body };
}

const ExternalActionDaemonDispatchResultSchema = z.union([
  ExternalActionDaemonDispatchInvalidRequestSchema,
  z.object({ kind: z.literal('response'), body: z.instanceof(Uint8Array)
    .refine((value) => value.byteLength <= EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES_V2) }).strict(),
]);

export function parseExternalActionDaemonDispatchResult(value: unknown): ParsedExternalActionDaemonDispatchResult | null {
  const parsed = ExternalActionDaemonDispatchResultSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.kind === 'invalid_request') return parsed.data;
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(parsed.data.body);
    const raw: unknown = JSON.parse(body);
    const encrypted = ExternalActionResponseEnvelopeV2Schema.safeParse(raw);
    if (encrypted.success) return { kind: 'response', prepared: {
      response: encrypted.data, body, byteLength: parsed.data.body.byteLength,
    } };
    return parseExternalActionDaemonDispatchResultV1(value);
  } catch { return null; }
}
