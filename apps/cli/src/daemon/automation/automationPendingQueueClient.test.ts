import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SessionInputAdmissionResultV1,
  SessionPendingEnqueueByMachineRequestV1,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { callSessionRpc } from '@/session/transport/rpc/sessionRpc';

vi.mock('@/session/transport/rpc/sessionRpc', () => ({
  callSessionRpc: vi.fn(async () => ({ ok: false, status: 'notRunning' })),
}));

type SessionTransportServer = Readonly<{
  baseUrl: string;
  state: {
    machineAdmissionRequests: SessionPendingEnqueueByMachineRequestV1[];
    pendingReads: string[];
    discarded: Array<Readonly<{
      sessionId: string;
      localId: string;
      body: unknown;
    }>>;
  };
  close: () => Promise<void>;
}>;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function startSessionTransportServer(params: Readonly<{
  mode?: 'plain' | 'e2ee';
  targetMachineId?: string;
  pendingLocalIds?: readonly string[];
  materializedLocalId?: string;
  /** When set, the discard endpoint always answers 404 with this body (proxy/legacy-route simulation). */
  discard404Body?: unknown;
}> = {}): Promise<SessionTransportServer> {
  const mode = params.mode ?? 'plain';
  const targetMachineId = params.targetMachineId ?? 'machine-hosting-session';
  const state: SessionTransportServer['state'] = {
    machineAdmissionRequests: [],
    pendingReads: [],
    discarded: [],
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/v1/account/encryption/currentness') {
      writeJson(response, 200, {
        mode,
        version: 1,
        signingKeyFingerprint: null,
        contentKeyFingerprint: null,
        updatedAt: 1,
      });
      return;
    }

    const pendingListMatch = request.method === 'GET'
      ? /^\/v2\/sessions\/([^/]+)\/pending$/.exec(url.pathname)
      : null;
    if (pendingListMatch) {
      state.pendingReads.push(decodeURIComponent(pendingListMatch[1]!));
      writeJson(response, 200, {
        pending: (params.pendingLocalIds ?? []).map((localId) => ({
          localId,
          status: 'queued',
          deliveryState: 'delivering',
        })),
      });
      return;
    }

    if (request.method === 'GET' && /^\/v2\/sessions\/[^/]+$/.test(url.pathname)) {
      const sessionId = decodeURIComponent(url.pathname.slice('/v2/sessions/'.length));
      writeJson(response, 200, {
        session: {
          id: sessionId,
          seq: 0,
          createdAt: 1,
          updatedAt: 1,
          active: true,
          activeAt: 1,
          encryptionMode: mode,
          metadata: mode === 'plain' ? '{}' : 'not-a-decryptable-e2ee-metadata-envelope',
          metadataVersion: 0,
          agentState: null,
          agentStateVersion: 0,
          dataEncryptionKey: null,
          machineId: targetMachineId,
        },
      });
      return;
    }

    const discardMatch = request.method === 'POST'
      ? /^\/v2\/sessions\/([^/]+)\/pending\/([^/]+)\/discard$/.exec(url.pathname)
      : null;
    if (discardMatch) {
      const localId = decodeURIComponent(discardMatch[2]!);
      state.discarded.push({
        sessionId: decodeURIComponent(discardMatch[1]!),
        localId,
        body: await readJsonBody(request),
      });
      if (params.discard404Body !== undefined) {
        writeJson(response, 404, params.discard404Body);
        return;
      }
      if (localId === params.materializedLocalId) {
        writeJson(response, 404, { error: 'not-found' });
        return;
      }
      writeJson(response, 200, { ok: true });
      return;
    }

    writeJson(response, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

/** Canonical session id shape so exact-session transport resolution never scans a list. */
const CANONICAL_SESSION_ID = 'cautomationrun42000000000';

describe('automation Session input composition', () => {
  const previousServerUrl = process.env.HAPPIER_SERVER_URL;
  const previousWebappUrl = process.env.HAPPIER_WEBAPP_URL;
  const activeServers: SessionTransportServer[] = [];

  afterEach(async () => {
    vi.mocked(callSessionRpc).mockReset();
    vi.mocked(callSessionRpc).mockResolvedValue({ ok: false, status: 'notRunning' });
    while (activeServers.length > 0) {
      await activeServers.pop()!.close();
    }
    if (previousServerUrl === undefined) delete process.env.HAPPIER_SERVER_URL;
    else process.env.HAPPIER_SERVER_URL = previousServerUrl;
    if (previousWebappUrl === undefined) delete process.env.HAPPIER_WEBAPP_URL;
    else process.env.HAPPIER_WEBAPP_URL = previousWebappUrl;
    vi.resetModules();
  });

  async function loadClient(params: Readonly<{
    mode?: 'plain' | 'e2ee';
    targetMachineId?: string;
    pendingLocalIds?: readonly string[];
    materializedLocalId?: string;
    discard404Body?: unknown;
  }> = {}) {
    const server = await startSessionTransportServer(params);
    activeServers.push(server);
    process.env.HAPPIER_SERVER_URL = server.baseUrl;
    process.env.HAPPIER_WEBAPP_URL = server.baseUrl;
    vi.resetModules();
    return {
      server,
      ...await import('./automationPendingQueueClient'),
    };
  }

  it('uses the canonical Session sender for accepted, already-accepted, rejected, and unknown machine outcomes', async () => {
    const localId = 'automation:run:run-42';
    const { enqueueAutomationPrompt, server } = await loadClient({
      targetMachineId: 'machine-on-another-daemon',
      pendingLocalIds: [localId],
    });
    const outcomes: readonly SessionInputAdmissionResultV1[] = [
      { status: 'accepted', localId },
      { status: 'alreadyAccepted', localId },
      { status: 'rejected', code: 'session_input_untrusted_assertion' },
      { status: 'outcomeUnknown', localId, code: 'response_lost' },
    ];

    for (const outcome of outcomes) {
      const machineAdmissionTransport = vi.fn(async (request: SessionPendingEnqueueByMachineRequestV1) => {
        server.state.machineAdmissionRequests.push(request);
        return outcome;
      });

      await expect(enqueueAutomationPrompt({
        credentials: { token: 'token', encryption: null },
        sessionId: 'session-automation-plain',
        automationId: 'automation-7',
        runId: 'run-42',
        prompt: 'Hello from automation',
        machineAdmissionTransport,
      })).resolves.toEqual(outcome);

      expect(machineAdmissionTransport).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-automation-plain',
        targetMachineId: 'machine-on-another-daemon',
        localId,
        requestedAction: { v: 1, kind: 'enqueue' },
        content: {
          t: 'plain',
          v: expect.objectContaining({
            role: 'user',
            content: { type: 'text', text: 'Hello from automation' },
            meta: expect.objectContaining({
              source: 'automation',
              happierProvenanceV1: {
                v: 1,
                kind: 'automation',
                automationId: 'automation-7',
                runId: 'run-42',
              },
              happierInputRequestV1: {
                v: 1,
                producer: 'automation',
                caller: { kind: 'host' },
                automation: { automationId: 'automation-7', runId: 'run-42' },
                permission: {},
              },
            }),
          }),
        },
      }));
    }

    expect(server.state.pendingReads).toEqual(['session-automation-plain']);
  });

  it('carries the picked composer references through the canonical structured-input envelope', async () => {
    const { enqueueAutomationPrompt, server } = await loadClient({
      targetMachineId: 'machine-on-another-daemon',
    });
    const sessionMention = {
      kind: 'happier.session',
      ref: 'session:sess-42',
      token: '@Nightly%20review',
      label: 'Nightly review',
    } as const;
    const machineAdmissionTransport = vi.fn(async (request: SessionPendingEnqueueByMachineRequestV1) => {
      server.state.machineAdmissionRequests.push(request);
      return { status: 'accepted', localId: 'automation:run:run-42' } as const;
    });

    await enqueueAutomationPrompt({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-automation-plain',
      automationId: 'automation-7',
      runId: 'run-42',
      prompt: 'Continue @Nightly%20review please',
      mentions: [sessionMention],
      machineAdmissionTransport,
    });

    expect(machineAdmissionTransport).toHaveBeenCalledWith(expect.objectContaining({
      content: {
        t: 'plain',
        v: expect.objectContaining({
          meta: expect.objectContaining({
            happierStructuredInputV1: { v: 1, mentions: [sessionMention] },
          }),
        }),
      },
    }));
  });

  it('omits the structured-input envelope when the Run carries no reference', async () => {
    const { enqueueAutomationPrompt, server } = await loadClient({
      targetMachineId: 'machine-on-another-daemon',
    });
    const machineAdmissionTransport = vi.fn(async (request: SessionPendingEnqueueByMachineRequestV1) => {
      server.state.machineAdmissionRequests.push(request);
      return { status: 'accepted', localId: 'automation:run:run-42' } as const;
    });

    await enqueueAutomationPrompt({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-automation-plain',
      automationId: 'automation-7',
      runId: 'run-42',
      prompt: 'No references here',
      mentions: [],
      machineAdmissionTransport,
    });

    const request = machineAdmissionTransport.mock.calls[0]![0];
    const content = request.content as Readonly<{ t: 'plain'; v: { meta: Record<string, unknown> } }>;
    expect(Object.keys(content.v.meta)).not.toContain('happierStructuredInputV1');
  });

  it('derives stable E2EE equality evidence despite randomized transport ciphertext', async () => {
    const { enqueueAutomationPrompt, server } = await loadClient({ mode: 'e2ee' });
    const credentials = {
      token: 'token-e2ee',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(7) },
    };
    const machineAdmissionTransport = vi.fn(async (request: SessionPendingEnqueueByMachineRequestV1) => {
      server.state.machineAdmissionRequests.push(request);
      return { status: 'accepted' as const, localId: String(request.localId) };
    });

    await enqueueAutomationPrompt({
      credentials,
      sessionId: 'session-automation-e2ee',
      automationId: 'automation-7',
      runId: 'run-42',
      prompt: 'Keep equality stable',
      machineAdmissionTransport,
    });
    await enqueueAutomationPrompt({
      credentials,
      sessionId: 'session-automation-e2ee',
      automationId: 'automation-7',
      runId: 'run-42',
      prompt: 'Keep equality stable',
      machineAdmissionTransport,
    });

    const [first, second] = server.state.machineAdmissionRequests;
    expect(first).toEqual(expect.objectContaining({
      localId: 'automation:run:run-42',
      content: { t: 'encrypted', c: expect.any(String) },
      requestEqualityEvidenceV1: { kind: 'e2eeTag', tag: expect.any(String) },
    }));
    expect(second).toEqual(expect.objectContaining({
      localId: first!.localId,
      content: { t: 'encrypted', c: expect.any(String) },
      requestEqualityEvidenceV1: first!.requestEqualityEvidenceV1,
    }));
    expect(second!.content).not.toEqual(first!.content);
  });

  it('does not discard an emitted prompt itself when either cancellation signal wins after machine admission', async () => {
    const { enqueueAutomationPrompt, server } = await loadClient();
    for (const reason of [
      Object.freeze({ kind: 'automationRunCancelled' }),
      new Error('generic attempt invalidation'),
    ]) {
      const cancellation = new AbortController();
      const machineAdmissionTransport = vi.fn(async (request: SessionPendingEnqueueByMachineRequestV1) => {
        server.state.machineAdmissionRequests.push(request);
        cancellation.abort(reason);
        return { status: 'accepted' as const, localId: String(request.localId) };
      });

      await expect(enqueueAutomationPrompt({
        credentials: { token: 'token', encryption: null },
        sessionId: 'session-automation-cancel',
        automationId: 'automation-7',
        runId: 'run-42',
        prompt: 'Cancellation races after machine emit',
        machineAdmissionTransport,
        signal: cancellation.signal,
      })).resolves.toEqual({ status: 'accepted', localId: 'automation:run:run-42' });
    }

    expect(server.state.discarded).toEqual([]);
  });

  it('uses the real pending-queue discard transport for exactly the stable Automation input', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient();

    await expect(discardAutomationPromptAfterRunCancellation({
      credentials: { token: 'token', encryption: null },
      sessionId: CANONICAL_SESSION_ID,
      automationId: 'automation-7',
      runId: 'run-42',
    })).resolves.toBeUndefined();

    expect(server.state.discarded).toEqual([{
      sessionId: CANONICAL_SESSION_ID,
      localId: 'automation:run:run-42',
      body: { reason: 'session_input_cancelled' },
    }]);

    // The input was retired while still queued, so it never materialized and
    // the loaded runtime holds no turn carrying this localId to cancel.
    expect(callSessionRpc).not.toHaveBeenCalled();
  });

  it('treats a session-not-found discard 404 as a terminal no-op instead of exact runtime cancellation', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient({
      discard404Body: { error: 'session-not-found' },
    });

    await expect(discardAutomationPromptAfterRunCancellation({
      credentials: { token: 'token', encryption: null },
      sessionId: CANONICAL_SESSION_ID,
      automationId: 'automation-7',
      runId: 'run-42',
    })).resolves.toBeUndefined();

    expect(server.state.discarded).toHaveLength(1);
    expect(callSessionRpc).not.toHaveBeenCalled();
  });

  it('keeps an untyped proxy 404 discard failure visible instead of masquerading as materialization', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient({
      discard404Body: 'Not Found',
    });

    await expect(discardAutomationPromptAfterRunCancellation({
      credentials: { token: 'token', encryption: null },
      sessionId: CANONICAL_SESSION_ID,
      automationId: 'automation-7',
      runId: 'run-42',
    })).rejects.toMatchObject({ response: { status: 404 } });

    expect(server.state.discarded).toHaveLength(1);
    expect(callSessionRpc).not.toHaveBeenCalled();
  });

  it('requests exact-turn cancellation for the same materialized Automation input after the discard', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient({
      materializedLocalId: 'automation:run:run-42',
    });
    vi.mocked(callSessionRpc).mockResolvedValue({
      ok: true,
      status: 'cancelled',
      sessionId: CANONICAL_SESSION_ID,
      localId: 'automation:run:run-42',
    });

    await discardAutomationPromptAfterRunCancellation({
      credentials: { token: 'token', encryption: null },
      sessionId: CANONICAL_SESSION_ID,
      automationId: 'automation-7',
      runId: 'run-42',
    });

    expect(server.state.discarded).toHaveLength(1);
    expect(callSessionRpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callSessionRpc).mock.calls[0]![0]).toEqual(expect.objectContaining({
      token: 'token',
      sessionId: CANONICAL_SESSION_ID,
      method: `${CANONICAL_SESSION_ID}:${SESSION_RPC_METHODS.SESSION_INPUT_CANCEL_EXACT_TURN_V1}`,
      request: {
        sessionId: CANONICAL_SESSION_ID,
        localId: 'automation:run:run-42',
      },
    }));
  });

  it('treats every non-cancelling exact-turn outcome as a no-op instead of broadening cancellation', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient({
      materializedLocalId: 'automation:run:run-42',
    });

    for (const outcome of [
      { ok: false, status: 'notCurrent', sessionId: CANONICAL_SESSION_ID, localId: 'automation:run:run-42' },
      { ok: false, status: 'notRunning', sessionId: CANONICAL_SESSION_ID, localId: 'automation:run:run-42' },
      {
        ok: false,
        status: 'unsupported',
        sessionId: CANONICAL_SESSION_ID,
        localId: 'automation:run:run-42',
        errorCode: 'unsupported_session_runtime_method',
      },
    ]) {
      vi.mocked(callSessionRpc).mockResolvedValueOnce(outcome);
      await expect(discardAutomationPromptAfterRunCancellation({
        credentials: { token: 'token', encryption: null },
        sessionId: CANONICAL_SESSION_ID,
        automationId: 'automation-7',
        runId: 'run-42',
      })).resolves.toBeUndefined();
    }

    expect(server.state.discarded).toHaveLength(3);
    expect(vi.mocked(callSessionRpc).mock.calls.every(
      ([call]) => (call as { method: string }).method.endsWith(SESSION_RPC_METHODS.SESSION_INPUT_CANCEL_EXACT_TURN_V1),
    )).toBe(true);
  });

  it('keeps an unreachable session runtime from failing the authoritative input retirement', async () => {
    const { discardAutomationPromptAfterRunCancellation, server } = await loadClient({
      materializedLocalId: 'automation:run:run-42',
    });
    vi.mocked(callSessionRpc).mockRejectedValueOnce(new Error('rpc method not available'));

    await expect(discardAutomationPromptAfterRunCancellation({
      credentials: { token: 'token', encryption: null },
      sessionId: CANONICAL_SESSION_ID,
      automationId: 'automation-7',
      runId: 'run-42',
    })).resolves.toBeUndefined();

    expect(server.state.discarded).toHaveLength(1);
  });
});
