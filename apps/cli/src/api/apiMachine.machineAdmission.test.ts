import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
  SESSION_PENDING_ENQUEUE_BY_MACHINE_EVENT_V1,
  SessionInputAdmissionResultV1Schema,
  SessionPendingEnqueueByMachineRequestV1Schema,
  type SessionInputAdmissionResultV1,
  type SessionPendingEnqueueByMachineRequestV1,
  SessionPendingExecutionRunEnqueueByMachineRequestV2Schema,
  SESSION_PENDING_EXECUTION_RUN_ENQUEUE_BY_MACHINE_EVENT_V2,
  API_TOKEN_FULL_GRANT_V1,
  ExternalActionMachineRpcExecutionV1Schema,
  verifyExternalActionMachineRpcRequestV1,
} from '@happier-dev/protocol';
import type { Machine } from '@/api/types';

import { ApiMachineClient } from './apiMachine';

const identityStore = vi.hoisted(() => ({ identity: null as import('@happier-dev/protocol').MachineInstallationIdentityV1 | null }));
// Installation key material is the OS boundary, not an alternate signer implementation.
vi.mock('@/daemon/identity/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/daemon/identity/store')>(),
  readInstallationIdentityIfExistsSync: () => identityStore.identity,
}));

function createMachine(): Machine {
  return {
    id: 'machine-1',
    encryptionKey: new Uint8Array(32).fill(1),
    encryptionVariant: 'legacy',
    metadata: null,
    metadataVersion: 0,
    daemonState: null,
    daemonStateVersion: 0,
  };
}

async function enqueueMachineAdmissionWithCancellation(
  client: ApiMachineClient,
  request: SessionPendingEnqueueByMachineRequestV1,
  signal: AbortSignal,
): Promise<SessionInputAdmissionResultV1> {
  return SessionInputAdmissionResultV1Schema.parse(await client.enqueueSessionPendingByMachine(
    request,
    { signal },
  ));
}

describe('ApiMachineClient machine admission transport', () => {
  it.each([1, 2] as const)('signs the exact V%s machine admission payload with the original input proof', async (version) => {
    const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    identityStore.identity = {
      version: 1, installationId: '11111111-1111-4111-8111-111111111111', createdAt: 1,
      publicKey: Buffer.from(key.publicKey).toString('base64url'), privateKey: Buffer.from(key.secretKey).toString('base64url'),
    };
    const authorization = { v: 1 as const, token: 'verified-home-proof', binding: {
      serverIdentityId: 'home', accountId: 'account', principalId: 'account',
      credentialId: '11111111-1111-4111-8111-111111111111', machineId: 'machine-1',
      actionId: 'session.message.send', requestId: 'rpc-input', requestEnvelopeDigest: 'A'.repeat(43),
      target: { kind: 'session' as const, sessionId: 'session-1' }, grant: API_TOKEN_FULL_GRANT_V1,
    } };
    const request = {
      v: version, sessionId: 'session-1', targetMachineId: 'machine-1', localId: 'bound-input',
      content: { t: 'encrypted' as const, c: 'ciphertext' }, requestedAction: { v: 1 as const, kind: 'enqueue' as const },
      ...(version === 2 ? { recipient: { kind: 'execution_run' as const, runId: 'run-1' } } : {}),
    };
    const parsedRequest = version === 2
      ? SessionPendingExecutionRunEnqueueByMachineRequestV2Schema.parse(request)
      : SessionPendingEnqueueByMachineRequestV1Schema.parse(request);
    const client = new ApiMachineClient('daemon-token', createMachine());
    let emitted: unknown;
    const emitWithAck = vi.fn(async (_event: string, payload: unknown) => {
      emitted = payload;
      return { v: version, result: { status: 'accepted', localId: 'bound-input' } };
    });
    Reflect.set(client, 'socket', { connected: true, timeout: () => ({ emitWithAck }) });
    await expect(client.enqueueSessionPendingByMachine(parsedRequest, { callerInputAuthorization: authorization }))
      .resolves.toEqual({ status: 'accepted', localId: 'bound-input' });
    expect(emitted).toMatchObject({ externalAction: { authorization } });
    const proof = ExternalActionMachineRpcExecutionV1Schema.parse(
      (emitted as Record<string, unknown>).externalAction,
    );
    const event = version === 1 ? SESSION_PENDING_ENQUEUE_BY_MACHINE_EVENT_V1 : SESSION_PENDING_EXECUTION_RUN_ENQUEUE_BY_MACHINE_EVENT_V2;
    const signatureInput = { authorizationToken: authorization.token, effectActionId: proof.effectActionId,
      target: proof.target, installationId: proof.installationId, event, method: event,
      requestId: authorization.binding.requestId, params: parsedRequest,
      publicKey: key.publicKey, signature: proof.machineSignature };
    expect(verifyExternalActionMachineRpcRequestV1(signatureInput)).toBe(true);
    expect(verifyExternalActionMachineRpcRequestV1({ ...signatureInput, params: { ...parsedRequest, localId: 'tampered' } })).toBe(false);
    identityStore.identity = null;
    emitWithAck.mockClear();
    await expect(client.enqueueSessionPendingByMachine(parsedRequest, { callerInputAuthorization: authorization }))
      .resolves.toEqual({ status: 'rejected', code: 'session_input_unauthorized' });
    expect(emitWithAck).not.toHaveBeenCalled();
  });

  it('dispatches target admission only through V2 and rejects an old acknowledgement', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const emitWithAck = vi.fn().mockResolvedValue({ v: 1, result: { status: 'accepted', localId: 'target-input' } });
    Reflect.set(client, 'socket', { connected: true, timeout: () => ({ emitWithAck }) });
    const request = SessionPendingExecutionRunEnqueueByMachineRequestV2Schema.parse({
      v: 2, sessionId: 'session-1', targetMachineId: 'machine-1',
      recipient: { kind: 'execution_run', runId: 'run-a' }, localId: 'target-input',
      content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'Target input' }, meta: {} } },
      requestedAction: { v: 1, kind: 'enqueue' },
    });
    await expect(client.enqueueSessionPendingByMachine(request)).resolves.toMatchObject({
      status: 'outcomeUnknown', localId: 'target-input',
    });
    expect(emitWithAck).toHaveBeenCalledWith(SESSION_PENDING_EXECUTION_RUN_ENQUEUE_BY_MACHINE_EVENT_V2, request);
    emitWithAck.mockResolvedValue({ v: 2, result: { status: 'accepted', localId: 'target-input' } });
    await expect(client.enqueueSessionPendingByMachine(request)).resolves.toEqual({ status: 'accepted', localId: 'target-input' });
  });
  it('returns a definite rejection when the socket is known disconnected before emit', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const emitWithAck = vi.fn();
    Reflect.set(client, 'socket', { connected: false, emitWithAck });
    const request = SessionPendingEnqueueByMachineRequestV1Schema.parse({
      v: 1,
      sessionId: 'session-1',
      targetMachineId: 'machine-1',
      localId: 'plugin-input-v1:disconnected-before-emit',
      content: {
        t: 'plain',
        v: { role: 'user', content: { type: 'text', text: 'plugin prompt' }, meta: {} },
      },
      requestedAction: { v: 1, kind: 'steer_if_active' },
    });

    await expect(client.enqueueSessionPendingByMachine(request)).resolves.toEqual({
      status: 'rejected',
      code: 'session_input_target_unavailable',
    });
    expect(emitWithAck).not.toHaveBeenCalled();
  });

  it('settles the socket acknowledgement on caller cancellation without serializing the signal', async () => {
    const client = new ApiMachineClient('token', createMachine());
    let acknowledge!: (value: unknown) => void;
    const emitWithAck = vi.fn((_event: string, _payload: unknown) => new Promise<unknown>((resolve) => {
      acknowledge = resolve;
    }));
    Reflect.set(client, 'socket', {
      connected: true,
      timeout: vi.fn(() => ({ emitWithAck })),
    });
    const cancellation = new AbortController();
    const request = SessionPendingEnqueueByMachineRequestV1Schema.parse({
      v: 1,
      sessionId: 'session-1',
      targetMachineId: 'machine-1',
      localId: 'plugin-input-v1:cancelled-machine-ack',
      content: {
        t: 'plain',
        v: {
          role: 'user',
          content: { type: 'text', text: 'plugin prompt' },
          meta: {},
        },
      },
      requestedAction: { v: 1, kind: 'steer_if_active' },
    });

    const pending = enqueueMachineAdmissionWithCancellation(client, request, cancellation.signal);
    await vi.waitFor(() => expect(emitWithAck).toHaveBeenCalledOnce());

    try {
      cancellation.abort();
      await expect(pending).resolves.toEqual({
        status: 'outcomeUnknown',
        localId: request.localId,
        code: 'machine_admission_cancelled_after_emit',
      });
      const [event, payload] = emitWithAck.mock.calls[0] ?? [];
      expect(event).toBe(SESSION_PENDING_ENQUEUE_BY_MACHINE_EVENT_V1);
      expect(payload).toEqual(request);
      expect(payload).not.toHaveProperty('signal');
    } finally {
      acknowledge({
        v: 1,
        result: { status: 'accepted', localId: request.localId },
      });
      await pending.catch(() => undefined);
    }
  });

  it('rejects cancellation before emit with no possible server effect', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const emitWithAck = vi.fn();
    Reflect.set(client, 'socket', {
      connected: true,
      timeout: vi.fn(() => ({ emitWithAck })),
    });
    const cancellation = new AbortController();
    cancellation.abort();
    const request = SessionPendingEnqueueByMachineRequestV1Schema.parse({
      v: 1,
      sessionId: 'session-1',
      targetMachineId: 'machine-1',
      localId: 'plugin-input-v1:cancelled-before-emit',
      content: {
        t: 'plain',
        v: { role: 'user', content: { type: 'text', text: 'plugin prompt' }, meta: {} },
      },
      requestedAction: { v: 1, kind: 'steer_if_active' },
    });

    await expect(enqueueMachineAdmissionWithCancellation(
      client,
      request,
      cancellation.signal,
    )).resolves.toEqual({
      status: 'rejected',
      code: 'session_input_cancelled',
    });
    expect(emitWithAck).not.toHaveBeenCalled();
  });
});
