import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

import { describe, expect, it } from 'vitest';
import { wrapApiTokenEncryptionAccessV1 } from '@happier-dev/protocol';
import { formatAccountApiTokenCredentialV1 } from '@happier-dev/protocol/auth/accountApiTokens';
import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import {
  ExternalActionRequestEnvelopeV2Schema,
  openExternalActionRequestV2,
  prepareExternalActionResponseV2,
  type ExternalActionEncryptionBindingV2,
  type ExternalActionRequestEnvelopeV2,
} from '@happier-dev/protocol/actions';

// Exercise the published entry point: protected credentials are useful only if
// the public SDK export reaches the privacy-preserving client implementation.
import { connect } from './index.public.js';
import { HappierClientClosedError, HappierTransportError } from './errors.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

const material = { type: 'dataKey' as const, machineKey: Uint8Array.from({ length: 32 }, (_, i) => i + 1) };
const pins = { serverIdentityId: 'srv_sdk', accountId: 'account-1',
  tokenId: '123e4567-e89b-42d3-a456-426614174000',
  contentPublicKey: 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=' };
const wrappingSecret = new Uint8Array(32).fill(7);
const bearer = `hap_v1_${pins.tokenId}_${encodeBase64(new Uint8Array(32).fill(8), 'base64url')}`;
const encryptionAccess = wrapApiTokenEncryptionAccessV1({ context: pins, wrappingSecret,
  contentPrivateKey: material.machineKey, randomBytes: (length) => new Uint8Array(length).fill(3) });
const token = formatAccountApiTokenCredentialV1({ bearer, serverIdentityId: pins.serverIdentityId,
  accountId: pins.accountId, contentPublicKey: pins.contentPublicKey,
  wrappingSecret: encodeBase64(wrappingSecret, 'base64url') });
const accessResponse = { v: 1, accountId: pins.accountId, tokenId: pins.tokenId, encryptionAccess };

type Invocation = Readonly<{ request: ExternalActionRequestEnvelopeV2; binding: ExternalActionEncryptionBindingV2; input: unknown }>;

async function serve(params: Readonly<{
  bootstrap?: (response: ServerResponse) => Promise<void> | void;
  invoke?: (invocation: Invocation, response: ServerResponse) => Promise<void> | void;
}> = {}) {
  const captured: Array<{ path: string; authorization: string | undefined; body: string }> = [];
  const failures: unknown[] = [];
  const send = (response: ServerResponse, body: unknown, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const path = request.url ?? '';
    captured.push({ path, authorization: request.headers.authorization, body });
    if (path.endsWith('/encryption-access')) {
      if (params.bootstrap) await params.bootstrap(response);
      else send(response, accessResponse);
      return;
    }
    if (path === '/v1/machines') { send(response, []); return; }
    const envelope = ExternalActionRequestEnvelopeV2Schema.parse(JSON.parse(body));
    if (!envelope.target) throw new Error('Expected target');
    const binding = { serverIdentityId: pins.serverIdentityId, accountId: pins.accountId,
      credentialId: pins.tokenId, actionId: decodeURIComponent(path.split('/').at(-1)!),
      requestId: envelope.requestId, target: envelope.target };
    const opened = openExternalActionRequestV2({ envelope, binding, material });
    if (!opened) throw new Error('Request did not authenticate');
    if (params.invoke) await params.invoke({ request: envelope, binding, input: opened.input }, response);
    else send(response, prepareExternalActionResponseV2({ binding, request: envelope, material,
      executedMachineId: binding.target.kind === 'machine' ? binding.target.machineId : 'machine-1',
      randomBytes: (length) => new Uint8Array(length).fill(4),
      execution: { ok: true, result: { status: 'accepted', localId: 'result-sentinel' } },
    }).response);
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => { failures.push(error); send(response, {}, 500); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return { endpoint: `http://127.0.0.1:${address.port}`, captured, failures, send,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

describe('SDK protected invocation lifecycle through real HTTP', () => {
  it('executes a Lane 10 Team credential Action with its whole request and result protected', async () => {
    const server = await serve({ invoke: ({ binding, input, request }, response) => {
      expect(binding.actionId).toBe('teams.credentials.entitled.list');
      expect(input).toEqual({ teamId: 'private-team-sentinel' });
      server.send(response, prepareExternalActionResponseV2({ binding, request, material,
        executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
        execution: { ok: true, result: { resources: [] } },
      }).response);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').actions.teams.credentials.entitled.list({
        teamId: 'private-team-sentinel',
      })).resolves.toEqual({ resources: [], nextCursor: null });
      expect(server.failures).toEqual([]);
      const actionCall = server.captured.find((call) => call.path.startsWith('/v1/actions/'));
      expect(actionCall?.path).toBe('/v1/actions/teams.credentials.entitled.list');
      expect(actionCall ? JSON.parse(actionCall.body).v : undefined).toBe(2);
      expect(actionCall?.body).not.toContain('private-team-sentinel');
      expect(JSON.stringify(server.captured)).not.toContain('resources');
    } finally { await client.close(); await server.close(); }
  });

  it('does not expose an arbitrary retry header from an untrusted non-JSON response', async () => {
    const server = await serve({ bootstrap: (response) => {
      response.writeHead(503, { 'x-happier-retry-reason': 'private-header-sentinel' });
      response.end('not JSON');
    } });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
        .rejects.toMatchObject({ code: undefined, status: 503, details: undefined });
      expect(server.captured).toHaveLength(1);
    } finally { await client.close(); await server.close(); }
  });

  it('refuses an authenticated result outside its declared output schema without disclosing it', async () => {
    const server = await serve({ invoke: ({ binding, request }, response) => server.send(response,
      prepareExternalActionResponseV2({ binding, request, material,
        executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
        execution: { ok: true, result: { resources: 'result-sentinel' } },
      }).response) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      const failure = await client.machine('machine-1').actions.teams.credentials.entitled.list({
        teamId: 'private-team-sentinel',
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ name: 'HappierTransportError', code: 'invalid_action_output' });
      expect((failure as HappierTransportError).details).toBeUndefined();
      expect(String((failure as Error).message)).not.toContain('result-sentinel');
      expect(server.failures).toEqual([]);
    } finally { await client.close(); await server.close(); }
  });

  it('preserves an unsupported encrypted transport code without retry or downgrade', async () => {
    const server = await serve({ invoke: (invocation, response) => server.send(response,
      {
        error: 'invalid_request',
        code: 'encrypted_action_unsupported',
        requestId: invocation.binding.requestId,
      }, 409) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
        .rejects.toMatchObject({ code: 'encrypted_action_unsupported', status: 409, details: undefined });
      expect(server.captured).toHaveLength(2);
    } finally { await client.close(); await server.close(); }
  });

  it('does not trust a protected outer error correlated to another request', async () => {
    const server = await serve({ invoke: (_invocation, response) => server.send(response, {
      error: 'invalid_request',
      code: 'target_unavailable',
      requestId: 'different-request',
    }, 409) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
        .rejects.toMatchObject({ code: undefined, status: 409, details: undefined });
      expect(server.captured).toHaveLength(2);
    } finally { await client.close(); await server.close(); }
  });

  it('preserves the strict PAT-self repair code without disclosing response details or downgrading', async () => {
    const server = await serve({ bootstrap: (response) => server.send(response, { error: 'api_token_encryption_stale' }, 409) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
        .rejects.toMatchObject({ code: 'api_token_encryption_stale', status: 409, details: undefined });
      expect(server.captured).toHaveLength(1);
    } finally { await client.close(); await server.close(); }
  });

  it.each([
    { ...accessResponse, accountId: 'wrong-account' },
    { ...accessResponse, tokenId: '223e4567-e89b-42d3-a456-426614174000' },
    { ...accessResponse, encryptionAccess: { ...encryptionAccess, serverIdentityId: 'srv_wrong' } },
    { ...accessResponse, encryptionAccess: { ...encryptionAccess, contentPublicKey: encodeBase64(new Uint8Array(32).fill(4), 'base64') } },
  ])('rejects a retrieved record outside the locally pinned binding', async (record) => {
    const server = await serve({ bootstrap: (response) => server.send(response, record) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
        .rejects.toMatchObject({ code: 'invalid_encrypted_envelope' });
      expect(server.captured).toHaveLength(1);
    } finally { await client.close(); await server.close(); }
  });

  it('protects stream and transcript cleanup before disposing the shared credential', async () => {
    const completed: string[] = [];
    const server = await serve({ invoke: ({ binding, request }, response) => {
      const result = binding.actionId === 'execution.run.stream.start' ? { streamId: 'stream-1' }
        : binding.actionId === 'transcript.follow'
          ? { items: [{ role: 'assistant', content: { t: 'encrypted', c: 'stored-row' } }], nextCursor: '1', truncated: false }
          : { ok: true };
      server.send(response, prepareExternalActionResponseV2({ binding, request, material,
        executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
        execution: { ok: true, result } }).response);
      completed.push(binding.actionId);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await client.machine('machine-1').runs.startStream({ runId: 'run-1', message: 'stream-sentinel' });
      const iterator = client.sessions.get('session-1').followTranscript()[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { content: { t: 'encrypted', c: 'stored-row' } } });
      await client.close();
      expect(completed).toContain('execution.run.stream.cancel');
      expect(completed).toContain('transcript.unfollow');
      expect(server.failures).toEqual([]);
      expect(server.captured.filter((call) => call.path.endsWith('/encryption-access'))).toHaveLength(1);
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))
        .every((call) => JSON.parse(call.body).v === 2)).toBe(true);
      expect(JSON.stringify(server.captured)).not.toContain('sentinel');
    } finally { await client.close(); await server.close(); }
  });

  it('shares lazy bootstrap across children and isolates one cancelled waiter', async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const server = await serve({ bootstrap: async (response) => {
      started.resolve(); await release.promise; server.send(response, accessResponse);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    const abort = new AbortController();
    const cancellation = new Error('cancel caller');
    try {
      expect(server.captured).toHaveLength(0);
      const cancelled = client.machine('machine-1').sessions.get('session-1').send('cancelled-sentinel', { signal: abort.signal });
      const rejected = expect(cancelled).rejects.toBe(cancellation);
      await started.promise;
      const live = client.machine('machine-2').sessions.get('session-2').send('input-sentinel');
      abort.abort(cancellation);
      release.resolve();
      await expect(live).resolves.toMatchObject({ status: 'accepted', localId: 'result-sentinel' });
      await rejected;
      await client.machines.list();
      expect(server.captured.filter((call) => call.path.endsWith('/encryption-access'))).toHaveLength(1);
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))).toHaveLength(1);
      expect(server.captured.every((call) => call.authorization === `Bearer ${bearer}`)).toBe(true);
      expect(JSON.stringify(server.captured)).not.toContain('sentinel');
      expect(JSON.stringify(server.captured)).not.toContain(token);
      expect(server.failures).toEqual([]);
    } finally { release.resolve(); await client.close(); await server.close(); }
  });

  it('retries only a failed read-only bootstrap on a later explicit invocation', async () => {
    let count = 0;
    const server = await serve({ bootstrap: (response) => server.send(response, ++count === 1 ? { error: 'unavailable' } : accessResponse, count === 1 ? 503 : 200) });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel')).rejects.toBeInstanceOf(HappierTransportError);
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))).toHaveLength(0);
      await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel')).resolves.toMatchObject({ localId: 'result-sentinel' });
      expect(count).toBe(2);
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))).toHaveLength(1);
    } finally { await client.close(); await server.close(); }
  });

  it('closes pending bootstrap and never starts an Action after late retrieval', async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const server = await serve({ bootstrap: async (response) => { started.resolve(); await release.promise; server.send(response, accessResponse); } });
    const client = connect({ endpoint: server.endpoint, token });
    try {
      const pending = client.machine('machine-1').sessions.get('session-1').send('input-sentinel');
      const rejected = expect(pending).rejects.toBeInstanceOf(HappierClientClosedError);
      await started.promise;
      await client.close(); release.resolve(); await rejected;
      await expect(client.machine('machine-2').sessions.get('session-2').send('late-sentinel')).rejects.toBeInstanceOf(HappierClientClosedError);
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))).toHaveLength(0);
    } finally { release.resolve(); await client.close(); await server.close(); }
  });

  it('carries every post-open outcome family inside the authenticated response', async () => {
    const server = await serve({ invoke: ({ binding, request }, response) => {
      const execution = binding.actionId === 'session.message.send'
        ? { ok: true as const, result: { status: 'outcomeUnknown', localId: 'turn-sentinel-id', code: 'session_input_outcome_unknown' } }
        : binding.actionId === 'execution.run.stop'
          ? { ok: false as const, errorCode: 'conflict', error: 'The Run is already stopping.' }
          : { ok: true as const, result: { kind: 'approval_request_created',
            artifactId: 'private-approval-artifact', actionId: binding.actionId } };
      server.send(response, prepareExternalActionResponseV2({ binding, request, material,
        executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
        execution }).response);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    const machineClient = client.machine('machine-1');
    const run = machineClient.sessions.get('session-1').runs.get('run-1');
    try {
      // `outcomeUnknown` keeps its own local id: no adapter collapses it into a
      // codeless wait failure and no mutation is retried.
      await expect(run.sendAndWait('turn-sentinel')).resolves
        .toEqual({ status: 'outcomeUnknown', localId: 'turn-sentinel-id', code: 'session_input_outcome_unknown' });
      // A post-open domain failure keeps its canonical code instead of arriving
      // as a bare HTTP error the client would have to guess about.
      await expect(run.stop()).rejects.toMatchObject({ name: 'HappierActionError', code: 'conflict' });
      // The same protected decoder serves both public seams: raw keeps the
      // approval as admitted domain data, fluent raises the typed refusal.
      await expect(machineClient.actions.execution.run.wait({ sessionId: 'session-1', runId: 'run-1' }))
        .resolves.toMatchObject({ kind: 'approval_request_created', artifactId: 'private-approval-artifact' });
      await expect(run.wait()).rejects.toMatchObject({
        name: 'HappierActionError', code: 'approval_required',
      });
      expect(server.failures).toEqual([]);
      expect(JSON.stringify(server.captured)).not.toContain('sentinel');
    } finally { await client.close(); await server.close(); }
  });

  it('surfaces a caller cancellation of an opened invocation without retry or downgrade', async () => {
    const reached = deferred<void>();
    const release = deferred<void>();
    const server = await serve({ invoke: async ({ binding, request }, response) => {
      reached.resolve();
      await release.promise;
      server.send(response, prepareExternalActionResponseV2({ binding, request, material,
        executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
        execution: { ok: true, result: { ok: true } } }).response);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    const abort = new AbortController();
    const cancellation = new Error('caller cancelled');
    try {
      const pending = client.machine('machine-1').sessions.get('session-1')
        .runs.get('run-1').send('turn-sentinel', {}, { signal: abort.signal });
      const rejected = expect(pending).rejects.toBe(cancellation);
      await reached.promise;
      abort.abort(cancellation);
      await rejected;
      release.resolve();
      // Exactly one admitted send: a lost response never becomes a second
      // sealed mutation.
      expect(server.captured.filter((call) => call.path.startsWith('/v1/actions/'))).toHaveLength(1);
      expect(JSON.stringify(server.captured)).not.toContain('sentinel');
    } finally { release.resolve(); await client.close(); await server.close(); }
  });

  it('rejects a response authenticated against a different target or tampered ciphertext', async () => {
    for (const corruption of ['target', 'ciphertext'] as const) {
      const server = await serve({ invoke: ({ binding, request }, response) => {
        const bound = corruption === 'target'
          // The daemon's own binding must cover the exact requested target: a
          // result sealed for another Machine is not this invocation's result.
          ? { ...binding, target: { kind: 'machine' as const, machineId: 'machine-2' } }
          : binding;
        const sealed = prepareExternalActionResponseV2({ binding: bound, request, material,
          executedMachineId: 'machine-1', randomBytes: (length) => new Uint8Array(length).fill(4),
          execution: { ok: true, result: { status: 'accepted', localId: 'result-sentinel' } } }).response;
        const payload = 'payload' in sealed ? sealed.payload : undefined;
        if (!payload) throw new Error('Expected a protected response payload');
        server.send(response, corruption === 'ciphertext'
          ? { ...sealed, payload: { ...payload, c: `${payload.c.slice(0, -4)}AAAA` } }
          : sealed);
      } });
      const client = connect({ endpoint: server.endpoint, token });
      try {
        await expect(client.machine('machine-1').sessions.get('session-1').send('input-sentinel'))
          .rejects.toMatchObject({ code: 'invalid_encrypted_envelope' });
        expect(JSON.stringify(server.captured)).not.toContain('sentinel');
      } finally { await client.close(); await server.close(); }
    }
  });

  it('rejects raw or stale authenticated responses without mutation retry', async () => {
    let first: unknown;
    let count = 0;
    const server = await serve({ invoke: ({ binding, request }, response) => {
      count += 1;
      first ??= prepareExternalActionResponseV2({ binding, request, material, executedMachineId: 'machine-1',
        randomBytes: (length) => new Uint8Array(length).fill(4),
        execution: { ok: true, result: { status: 'accepted', localId: 'first-sentinel-id' } } }).response;
      server.send(response, count === 3 ? { v: 1, actionId: binding.actionId, requestId: binding.requestId, execution: { ok: true, result: 'raw' } } : first);
    } });
    const client = connect({ endpoint: server.endpoint, token });
    const session = client.machine('machine-1').sessions.get('session-1');
    try {
      await expect(session.send('first-sentinel', { requestId: 'same-id' }))
        .resolves.toEqual({ status: 'accepted', localId: 'first-sentinel-id' });
      await expect(session.send('second-sentinel', { requestId: 'same-id' })).rejects.toMatchObject({ code: 'invalid_encrypted_envelope' });
      await expect(session.send('third-sentinel', { requestId: 'same-id' })).rejects.toMatchObject({ code: 'invalid_encrypted_envelope' });
      expect(count).toBe(3);
      expect(JSON.stringify(server.captured)).not.toContain('sentinel');
    } finally { await client.close(); await server.close(); }
  });
});
