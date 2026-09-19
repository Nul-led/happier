import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { fetchAccountMachineReplacements } from '@/api/machine/fetchAccountMachineReplacements';
import { createUserScopedSocket } from '@/api/session/sockets';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import {
  resolvePublishedMachineContentCodec,
  type ExpectedRunnerMachineContentKeyBindingScope,
} from '@/api/machine/machineDataEncryptionKey';
import type { StoredCredentials } from '@/persistence';
import { waitForSocketConnect } from '@/session/transport/socket/waitForSocketConnect';
import { createSocketRpcAbortScope, type SocketRpcAbortScope } from '@/session/transport/socket/createSocketRpcAbortScope';
import { resolveSessionControlSocketConnectTimeoutMs } from '@/session/transport/shared/sessionTimeouts';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import type { SocketRpcAuthorizationContext } from '@happier-dev/protocol/rpc';
import { createRpcCallError, isRpcMethodNotAvailableError } from '@happier-dev/protocol/rpcErrors';
import { resolveCanonicalMachineId } from '@happier-dev/protocol';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type { ActionExecutorContext } from '@happier-dev/protocol/actions';
import {
  createExternalActionAuthorizedRequestHeaders,
  createExternalActionMachineRpcExecution,
  type ExternalActionMachineRequestSigningKey,
} from '@/api/externalActionExecutionAuthorization';
import {
  markRpcRequestDisposition,
  readRpcRequestDisposition,
  type RpcRequestDisposition,
} from './rpcRequestDisposition';

export type MachineRpcRequestDisposition = RpcRequestDisposition;
export const readMachineRpcRequestDisposition = readRpcRequestDisposition;

export class MachineRpcEncryptionModeMismatchError extends Error {
  readonly code = 'machine_content_mode_mismatch' as const;

  constructor(readonly machineId: string) {
    super(`Machine ${machineId} content mode does not match the verified caller's expectation`);
    this.name = 'MachineRpcEncryptionModeMismatchError';
  }
}

export class MachineRpcTargetNotCurrentError extends Error {
  readonly code = 'machine_target_not_current' as const;

  constructor(readonly machineId: string) {
    super(`Machine ${machineId} is revoked or has been replaced`);
    this.name = 'MachineRpcTargetNotCurrentError';
  }
}

export class MachineRpcMachineKindMismatchError extends Error {
  readonly code = 'machine_kind_mismatch' as const;

  constructor(
    readonly machineId: string,
    readonly expectedKind: 'persistent' | 'ephemeral_session_runner',
  ) {
    super(`Machine ${machineId} is not a ${expectedKind}`);
    this.name = 'MachineRpcMachineKindMismatchError';
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

async function waitForConnectWithSignal(
  connectPromise: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await connectPromise;
    return;
  }
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([connectPromise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function resolveMachineRpcContentCodec(params: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  serverUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  expectedRunnerMachineContentKeyBinding?: ExpectedRunnerMachineContentKeyBindingScope;
  requireCurrentMachine?: boolean;
  requiredMachineKind?: 'persistent' | 'ephemeral_session_runner';
  externalAction?: Readonly<{
    context: ActionExecutorContext;
    effectActionId: string;
    installationId: string;
    privateKey: ExternalActionMachineRequestSigningKey;
  }>;
}>) {
  const path = `/v1/machines/${encodeURIComponent(params.machineId)}`;
  const externalAuthorization = params.externalAction?.context.externalActionExecutionAuthorization;
  const externalTarget = params.externalAction?.context.externalActionTarget;
  if (params.externalAction && (!externalAuthorization || !externalTarget)) {
    throw new Error('External Action Machine HTTP authorization is unavailable');
  }
  const response = await axios.get(
    `${params.serverUrl ?? resolveServerHttpBaseUrl()}${path}`,
    {
      headers: {
        ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(),
        ...(params.externalAction && externalAuthorization && externalTarget
          ? createExternalActionAuthorizedRequestHeaders({
              authorization: externalAuthorization,
              effectActionId: params.externalAction.effectActionId,
              target: externalTarget,
              installationId: params.externalAction.installationId,
              method: 'GET',
              path,
              privateKey: params.externalAction.privateKey,
            })
          : { Authorization: `Bearer ${params.credentials.token}` }),
      },
      timeout: params.timeoutMs,
      ...(params.signal ? { signal: params.signal } : {}),
    },
  );
  const raw = response.data?.machine as
    | {
        id?: unknown;
        kind?: 'persistent' | 'ephemeral_session_runner';
        installationId?: string | null;
        dataEncryptionKey?: unknown;
        runnerContentKeyBinding?: unknown;
        revokedAt?: unknown;
        replacedByMachineId?: unknown;
      }
    | null
    | undefined;
  if (String(raw?.id ?? '').trim() !== params.machineId) {
    throw new Error(`Machine ${params.machineId} was not returned by the server`);
  }
  if (
    params.requireCurrentMachine === true
    && (
      (raw?.revokedAt !== null && raw?.revokedAt !== undefined)
      || (typeof raw?.replacedByMachineId === 'string' && raw.replacedByMachineId.trim().length > 0)
    )
  ) {
    throw new MachineRpcTargetNotCurrentError(params.machineId);
  }
  const actualMachineKind = raw?.kind ?? 'persistent';
  if (params.requiredMachineKind && actualMachineKind !== params.requiredMachineKind) {
    throw new MachineRpcMachineKindMismatchError(params.machineId, params.requiredMachineKind);
  }
  return resolvePublishedMachineContentCodec({
    credentials: params.credentials,
    machineId: params.machineId,
    publishedDataEncryptionKey: raw?.dataEncryptionKey,
    machineKind: raw?.kind,
    installationId: raw?.installationId,
    runnerContentKeyBinding: raw?.runnerContentKeyBinding,
    ...(params.expectedRunnerMachineContentKeyBinding
      ? { expectedRunnerMachineContentKeyBinding: params.expectedRunnerMachineContentKeyBinding }
      : {}),
  });
}

/** One exact account-scoped machine RPC; retry and target selection stay caller-owned. */
export async function callExactMachineRpc(params: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  serverUrl?: string;
  method: string;
  request: unknown;
  authorization?: SocketRpcAuthorizationContext;
  /** Captured from verified Account/Machine context, never inferred from key presence. */
  expectedEncryptionMode?: 'plain' | 'e2ee';
  /** Independently trusted Home/Account/Machine scope required for an encrypted Runner Machine. */
  expectedRunnerMachineContentKeyBinding?: ExpectedRunnerMachineContentKeyBindingScope;
  /** Reject a revoked/replaced row before encryption or socket emission. */
  requireCurrentMachine?: boolean;
  /** Reject a different Machine class before encryption or socket emission. */
  requiredMachineKind?: 'persistent' | 'ephemeral_session_runner';
  /** Null delegates acknowledgement lifetime to the caller signal/server lifecycle. */
  timeoutMs?: number | null;
  signal?: AbortSignal;
  externalAction?: Readonly<{
    context: ActionExecutorContext;
    effectActionId: string;
    installationId: string;
    privateKey: ExternalActionMachineRequestSigningKey;
  }>;
}>): Promise<unknown> {
  let socket: ReturnType<typeof createUserScopedSocket> | null = null;
  let abortScope: SocketRpcAbortScope | null = null;
  let requestEmitted = false;
  try {
    params.signal?.throwIfAborted();
    const machineId = params.machineId.trim();
    if (!machineId) throw new Error('Machine id is required');
    const activeSocket = createUserScopedSocket({ token: params.credentials.token, ...(params.serverUrl ? { serverUrl: params.serverUrl } : {}) });
    socket = activeSocket;
    abortScope = createSocketRpcAbortScope({
      socket: activeSocket,
      ...(params.signal ? { callerSignal: params.signal } : {}),
      disconnectError: () => new Error('Machine RPC socket disconnected before acknowledgement'),
    });
    const rpcSignal = abortScope.signal;
    const acknowledgementTimeoutMs = params.timeoutMs === null
      ? null
      : typeof params.timeoutMs === 'number' && params.timeoutMs > 0
        ? params.timeoutMs
        : 20_000;
    const setupTimeoutMs = typeof acknowledgementTimeoutMs === 'number' ? acknowledgementTimeoutMs : 20_000;
    const connectTimeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0
      ? setupTimeoutMs
      : resolveSessionControlSocketConnectTimeoutMs();
    const machineCodec = await resolveMachineRpcContentCodec({
      credentials: params.credentials,
      machineId,
      serverUrl: params.serverUrl,
      timeoutMs: setupTimeoutMs,
      ...(params.expectedRunnerMachineContentKeyBinding
        ? { expectedRunnerMachineContentKeyBinding: params.expectedRunnerMachineContentKeyBinding }
        : {}),
      ...(params.requireCurrentMachine ? { requireCurrentMachine: true } : {}),
      ...(params.requiredMachineKind ? { requiredMachineKind: params.requiredMachineKind } : {}),
      ...(params.externalAction
        ? {
            externalAction: {
              context: params.externalAction.context,
              effectActionId: params.externalAction.effectActionId,
              installationId: params.externalAction.installationId,
              privateKey: params.externalAction.privateKey,
            },
          }
        : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (params.expectedEncryptionMode !== undefined && machineCodec.mode !== params.expectedEncryptionMode) {
      throw new MachineRpcEncryptionModeMismatchError(machineId);
    }
    const connectPromise = waitForSocketConnect(activeSocket as unknown as import('socket.io-client').Socket, connectTimeoutMs);
    activeSocket.connect();
    rpcSignal.throwIfAborted();
    await waitForConnectWithSignal(connectPromise, rpcSignal);
    rpcSignal.throwIfAborted();
    const encodedRequest = machineCodec.encodeRpc(params.request);
    const method = `${machineId}:${params.method}`;
    const requestId = randomUUID();
    const externalActionExecution = params.externalAction
      ? createExternalActionMachineRpcExecution({
          context: params.externalAction.context,
          effectActionId: params.externalAction.effectActionId,
          installationId: params.externalAction.installationId,
          method,
          ...(requestId === undefined ? {} : { requestId }),
          params: encodedRequest,
          privateKey: params.externalAction.privateKey,
        })
      : null;
    if (params.externalAction && !externalActionExecution) {
      throw new Error('External Action Machine RPC authorization is unavailable');
    }
    const response = await new Promise<{ ok: boolean; result?: unknown; error?: string; errorCode?: string }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        rpcSignal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(abortReason(rpcSignal)));
      rpcSignal.addEventListener('abort', onAbort, { once: true });
      if (rpcSignal.aborted) {
        onAbort();
        return;
      }
      if (acknowledgementTimeoutMs !== null) {
        timer = setTimeout(() => finish(() => reject(Object.assign(new Error('Machine RPC call timeout'), {
          code: 'MACHINE_RPC_TIMEOUT',
        }))), acknowledgementTimeoutMs);
      }
      try {
        requestEmitted = true;
        activeSocket.emit(
          SOCKET_RPC_EVENTS.CALL,
          {
            method,
            params: encodedRequest,
            requestId,
            ...(externalActionExecution ? { externalActionExecution } : {}),
            ...(acknowledgementTimeoutMs !== null ? { timeoutMs: acknowledgementTimeoutMs } : {}),
            ...(params.authorization ? { authorization: params.authorization } : {}),
          },
          (payload: { ok: boolean; result?: unknown; error?: string; errorCode?: string }) => finish(() => resolve(payload)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
    if (!response.ok) {
      throw createRpcCallError({ error: response.error || 'Machine RPC call failed', errorCode: response.errorCode });
    }
    return machineCodec.decodeRpc(response.result);
  } catch (error) {
    throw markRpcRequestDisposition(error, requestEmitted ? 'outcomeUnknown' : 'notSent');
  } finally {
    abortScope?.dispose();
    if (socket) {
      try {
        socket.disconnect();
        socket.close();
      } catch {
        // Preserve the original result.
      }
    }
  }
}

/**
 * The machine this recorded id IS now, when the recorded one could not be
 * reached and only then.
 *
 * A replaced machine keeps its row and gains a forward pointer, and nothing
 * re-homes the Sessions, recent paths or RPC targets that named it — so the
 * recorded id stays the predecessor forever. Resolution reuses the one
 * replacement walk the UI target resolvers and the daemon-side entitlement gate
 * already share; a second walk would let this client address a successor the
 * daemon then refuses as foreign.
 *
 * `null` whenever nothing changes hands: no chain recorded, an unreadable chain,
 * or a canonical id equal to the one already tried. The caller's fallback is the
 * original error, so every failure here is inert.
 */
async function resolveSuccessorMachineId(params: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
}>): Promise<string | null> {
  const machines = await fetchAccountMachineReplacements({ credentials: params.credentials });
  if (!machines) return null;
  const canonicalMachineId = resolveCanonicalMachineId(params.machineId, machines)?.machineId ?? null;
  return canonicalMachineId && canonicalMachineId !== params.machineId.trim()
    ? canonicalMachineId
    : null;
}

/**
 * One account-scoped machine RPC, addressed to the machine the recorded id names
 * TODAY.
 *
 * A user who replaces a machine keeps the Sessions the previous one hosted, so a
 * CLI- or MCP-driven send or resume must not die with the predecessor. Resolving
 * the replacement chain is a no-op unless a replacement was actually recorded,
 * so it is paid on FAILURE rather than on every call: the recorded id is
 * addressed exactly as before, and only a machine the server could find no
 * target for is re-addressed — exactly once, and only when the chain names a
 * different machine. A reached machine, including one that answered with an
 * error, pays nothing and is never re-addressed; re-running an answered call
 * against a different machine would be a correctness bug, and an unknown outcome
 * could execute twice. When nothing changes hands the ORIGINAL error surfaces
 * unchanged, because the user's problem is the RPC and not the lookup.
 *
 * Private material delivery uses callExactMachineRpc directly: replacement
 * resolution is deliberately absent from that operation.
 */
export async function callMachineRpc(params: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  method: string;
  request: unknown;
  authorization?: SocketRpcAuthorizationContext;
  timeoutMs?: number | null;
  signal?: AbortSignal;
}>): Promise<unknown> {
  try {
    return await callExactMachineRpc(params);
  } catch (error) {
    // Only "the server found no target for this machine" may be re-addressed:
    // it proves the request reached no machine at all.
    if (!isRpcMethodNotAvailableError(error)) throw error;
    const successorMachineId = await resolveSuccessorMachineId({
      credentials: params.credentials,
      machineId: params.machineId,
    });
    if (!successorMachineId) throw error;
    return await callExactMachineRpc({ ...params, machineId: successorMachineId });
  }
}
