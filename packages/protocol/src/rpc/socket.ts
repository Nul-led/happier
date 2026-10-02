import { z } from 'zod';
import type { ActionRequiredAuthority } from '../actions/metadata.js';
import type { CallerInputConstraintsV1 } from '../auth/apiTokenGrant.js';
import { RPC_METHODS, SESSION_RPC_METHODS } from './methods.js';
import { SessionIdSchema } from '../sessions/idsV1.js';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { AgentStartSessionCallerV1Schema } from '../account/settings/admitAgentStartV1.js';
import { AgentPermissionIntentV1Schema } from '../runtime/permissionIntentV1.js';
import { SessionInputCausalPermissionAuthorityV1Schema } from '../sessions/messages/sessionInputAdmission.js';
import { RoleActionInputSchemasV1 } from '../prompts/roles/roleActionsV1.js';

import type { SocketRpcAuthorizationContext } from './index.js';
import type { ExternalActionMachineRpcExecutionV1, ExternalActionExecutionAuthorizationV1 } from '../actions/externalActionApi.js';

export const SOCKET_RPC_EVENTS = {
  REGISTER: 'rpc-register',
  REGISTERED: 'rpc-registered',
  UNREGISTER: 'rpc-unregister',
  UNREGISTERED: 'rpc-unregistered',
  ERROR: 'rpc-error',
  CALL: 'rpc-call',
  REQUEST: 'rpc-request',
  CANCEL: 'rpc-cancel',
  MACHINE_TRANSFER_ENVELOPE: 'machine-transfer-envelope',
} as const;

export type SocketRpcEvent = (typeof SOCKET_RPC_EVENTS)[keyof typeof SOCKET_RPC_EVENTS];

export const SOCKET_RPC_TRANSPORT_RESPONSE_ENVELOPE_VERSION_V1 = 1 as const;

/**
 * Opaque, short-lived RPC correlation. The relay stamps a fresh value before it
 * reaches an RPC target, so a caller-local collision cannot cancel another
 * caller's request at that target.
 */
export const SocketRpcRequestIdSchema = z.string().trim().min(1).max(160);

/** Original host-admitted Action facts, distinct from relay request correlation. Every object is closed. */
export const SessionActionRpcOriginV1Schema = z.object({
  v: z.literal(1),
  caller: AgentStartSessionCallerV1Schema,
  sourceTurnId: z.string().trim().min(1),
  callerPermissionMode: asProtocolZod(AgentPermissionIntentV1Schema).nullable(),
  causalPermissionAuthority: SessionInputCausalPermissionAuthorityV1Schema.nullable().optional(),
  workspaceWrites: z.enum(['allow', 'deny']).optional(),
  requestId: z.string().trim().min(1),
}).strict();
export type SessionActionRpcOriginV1 = Readonly<z.infer<typeof SessionActionRpcOriginV1Schema>>;

export const SocketRpcSessionActionAuthorizationContextSchema = z.object({
  kind: z.literal('session.action'),
  sessionId: AgentStartSessionCallerV1Schema.shape.sessionId,
  origin: SessionActionRpcOriginV1Schema,
}).strict();
export type SocketRpcSessionActionAuthorizationContext = Readonly<z.infer<typeof SocketRpcSessionActionAuthorizationContextSchema>>;

/** The existing role Action family is the only Session-origin RPC corridor. */
export function isSessionActionRpcMethodV1(method: string): boolean {
  const unscoped = method.slice(method.lastIndexOf(':') + 1);
  return (unscoped.startsWith('session.') && Object.hasOwn(RoleActionInputSchemasV1, unscoped))
    || unscoped === SESSION_RPC_METHODS.SESSION_ROLES_CONFIGURATION_SET;
}

export const SocketRpcCancellationPayloadSchema = z.object({
  requestId: SocketRpcRequestIdSchema,
}).strict();

export type SocketRpcCancellationPayload = z.infer<typeof SocketRpcCancellationPayloadSchema>;

/** Non-secret routing metadata; file names, bytes and handles remain in the Session payload. */
export const SessionTransferRpcMethodV1Schema = z.enum([
    RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT, RPC_METHODS.DAEMON_TRANSFER_UPLOAD_CHUNK,
    RPC_METHODS.DAEMON_TRANSFER_UPLOAD_FINALIZE, RPC_METHODS.DAEMON_TRANSFER_UPLOAD_ABORT,
    RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_INIT, RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_CHUNK,
    RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_FINALIZE, RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_ABORT,
  ]);
export const SessionTransferRoutingV1Schema = z.object({
  method: SessionTransferRpcMethodV1Schema,
  t: z.enum(['session_attachment_upload_v1', 'session_attachment_download_v1']),
  sessionId: asProtocolZod(SessionIdSchema),
}).strict().refine(value => ([RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT, RPC_METHODS.DAEMON_TRANSFER_UPLOAD_CHUNK,
  RPC_METHODS.DAEMON_TRANSFER_UPLOAD_FINALIZE, RPC_METHODS.DAEMON_TRANSFER_UPLOAD_ABORT] as readonly string[]).includes(value.method)
  ? value.t === 'session_attachment_upload_v1'
  : value.t !== 'session_attachment_upload_v1');

export type SessionTransferRoutingV1 = Readonly<z.infer<typeof SessionTransferRoutingV1Schema>>;

export type SocketRpcRequestPayload = Readonly<{
  method: string;
  /** Verified relay stamps only; receiver defaults missing authority to automation. */
  callerAuthority?: ActionRequiredAuthority;
  /** Home-validated source Machine stamp; never accepted from an inbound header. */
  sessionActionOrigin?: SessionActionRpcOriginV1;
  callerInputConstraints?: CallerInputConstraintsV1;
  /** Server-issued invocation proof; the relay never forwards caller-authored material here. */
  callerInputAuthorization?: ExternalActionExecutionAuthorizationV1;
  transferRouting?: SessionTransferRoutingV1;
  params: unknown;
  /**
   * Ephemeral transport correlation. Issuers use it to cancel their own
   * in-flight relay; the authenticated relay replaces it before target dispatch.
   */
  requestId?: string;
  authorization?: SocketRpcAuthorizationContext;
  externalActionExecution?: ExternalActionMachineRpcExecutionV1;
  timeoutMs?: number;
  transportResponseEnvelopeVersion?: typeof SOCKET_RPC_TRANSPORT_RESPONSE_ENVELOPE_VERSION_V1;
}>;

export const SocketRpcTransportAcknowledgementV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session.stop'),
    status: z.literal('stopped'),
  }).strict(),
]);

export type SocketRpcTransportAcknowledgementV1 =
  z.infer<typeof SocketRpcTransportAcknowledgementV1Schema>;

export const SocketRpcTransportResponseEnvelopeV1Schema = z.object({
  v: z.literal(SOCKET_RPC_TRANSPORT_RESPONSE_ENVELOPE_VERSION_V1),
  result: z.unknown(),
  acknowledgement: SocketRpcTransportAcknowledgementV1Schema.optional(),
}).strict().refine(
  (value) => Object.prototype.hasOwnProperty.call(value, 'result'),
  { message: 'result is required', path: ['result'] },
);

export type SocketRpcTransportResponseEnvelopeV1 =
  z.infer<typeof SocketRpcTransportResponseEnvelopeV1Schema>;
