import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { bindApiSessionSocketMock, createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';
import { createAccountEncryptionCurrentnessFixture } from '@/testkit/backends/sessionFixtures';

import { deriveBoxPublicKeyFromSeed, sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: mockIo }));

describe('happier session run wait (integration)', () => {
  const envKeys = ['HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_HOME_DIR'] as const;
  let envScope = createEnvKeyScope(envKeys);
  let server: Server | null = null;
  let happyHomeDir = '';
  let observedRpcMethods: string[] = [];

  /** The one run shape both `execution.run.wait` and `execution.run.get` project. */
  const buildRunSnapshot = (status: 'running' | 'succeeded') => ({
    runId: 'run_1',
    callId: 'call_1',
    sidechainId: 'call_1',
    intent: 'review',
    backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
    permissionMode: 'read_only',
    retentionPolicy: 'ephemeral',
    runClass: 'bounded',
    ioMode: 'request_response',
    status,
    startedAtMs: 1,
    ...(status !== 'running' ? { finishedAtMs: 2 } : {}),
  });

  beforeEach(async () => {
    observedRpcMethods = [];
    happyHomeDir = await createTempDir('happier-cli-session-run-wait-');

    const sessionId = 'sess_integration_run_wait_123';
    const dek = new Uint8Array(32).fill(3);
    const machineKeySeed = new Uint8Array(32).fill(8);
    const recipientPublicKey = deriveBoxPublicKeyFromSeed(machineKeySeed);
    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey: dek,
      recipientPublicKey,
      randomBytes: (length) => new Uint8Array(length).fill(5),
    });

    const { encodeBase64: encodeBase64Session, encryptWithDataKey } = await import('@/api/encryption');
    const metadataCiphertext = encodeBase64Session(encryptWithDataKey({ path: '/tmp' }, dek), 'base64');
    const dataEncryptionKeyBase64 = encodeBase64Session(envelope, 'base64');

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/v2/account/settings') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          version: 1,
          content: { t: 'plain', v: { schemaVersion: 2, actionsSettingsV1: { v: 1, actions: {} } } },
        }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/account/encryption/currentness') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(createAccountEncryptionCurrentnessFixture({
          mode: 'e2ee',
          version: 1,
          updatedAt: 1,
        })));
        return;
      }
      if (req.method === 'GET' && url.pathname === `/v2/sessions/${sessionId}`) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            session: {
              id: sessionId,
              seq: 1,
              createdAt: 1,
              updatedAt: 2,
              active: false,
              activeAt: 0,
              metadata: metadataCiphertext,
              metadataVersion: 0,
              agentState: null,
              agentStateVersion: 0,
              pendingCount: 0,
              pendingVersion: 0,
              dataEncryptionKey: dataEncryptionKeyBase64,
              share: null,
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to resolve integration server address');

    process.env.HAPPIER_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.HAPPIER_WEBAPP_URL = 'http://127.0.0.1:3000';
    process.env.HAPPIER_HOME_DIR = happyHomeDir;

    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();


    const { decodeBase64, decrypt, encodeBase64: encodeBase64Rpc, encrypt } = await import('@/api/encryption');
    // `happier session run wait` asks the daemon to observe the run:
    // `execution.run.wait` owns the deadline and answers with the terminal run.
    // `execution.run.get` is reached only after that method answers unavailable
    // or not-found, so a fixture that only answers `get` never exercises the
    // production path at all.
    const socket = createApiSessionSocketStub({
      emit: (event: string, args: unknown[]) => {
        const [data, cb] = args as [any, ((value: unknown) => void) | undefined];
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const method = String(data.method ?? '');
        const decodedParams = decodeBase64(String(data.params ?? ''), 'base64');
        const decrypted = decrypt(dek, 'dataKey', decodedParams) as any;
        expect(decrypted).toMatchObject({ runId: 'run_1' });

        if (method === `${sessionId}:${SESSION_RPC_METHODS.EXECUTION_RUN_WAIT}`) {
          observedRpcMethods.push(SESSION_RPC_METHODS.EXECUTION_RUN_WAIT);
          cb?.({
            ok: true,
            result: encodeBase64Rpc(encrypt(dek, 'dataKey', {
              ok: true,
              status: 'succeeded',
              result: { run: buildRunSnapshot('succeeded') },
            }), 'base64'),
          });
          return;
        }
        if (method !== `${sessionId}:${SESSION_RPC_METHODS.EXECUTION_RUN_GET}`) return;
        observedRpcMethods.push(SESSION_RPC_METHODS.EXECUTION_RUN_GET);
        cb?.({
          ok: true,
          result: encodeBase64Rpc(encrypt(dek, 'dataKey', { run: buildRunSnapshot('succeeded') }), 'base64'),
        });
      },
    });
    bindApiSessionSocketMock(mockIo, socket);
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    server = null;
    if (happyHomeDir) {
      await removeTempDir(happyHomeDir);
      happyHomeDir = '';
    }

    envScope.restore();
    envScope = createEnvKeyScope(envKeys);


    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
  });

  it('settles on the daemon execution run wait result without reaching execution run get', async () => {
    const { handleSessionCommand } = await import('../index');

    const output = captureConsoleJsonOutput();

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(['run', 'wait', 'sess_integration_run_wait_123', 'run_1', '--timeout', '1', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'dataKey', publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed), machineKey: machineKeySeed },
        }),
      });

      const parsed = output.json();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('session_run_wait');
      expect(parsed.data?.sessionId).toBe('sess_integration_run_wait_123');
      expect(parsed.data?.runId).toBe('run_1');
      expect(parsed.data?.status).toBe('succeeded');
      expect(observedRpcMethods).toEqual([SESSION_RPC_METHODS.EXECUTION_RUN_WAIT]);
    } finally {
      output.restore();
    }
  });

  it('reaches execution run get only after the wait method answers unavailable', async () => {
    const { handleSessionCommand } = await import('../index');

    const output = captureConsoleJsonOutput();

    const { encodeBase64: encodeBase64Rpc, encrypt } = await import('@/api/encryption');
    const dek = new Uint8Array(32).fill(3);
    const sessionId = 'sess_integration_run_wait_123';
    const socket = createApiSessionSocketStub({
      emit: (event: string, args: unknown[]) => {
        const [data, cb] = args as [any, ((value: unknown) => void) | undefined];
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const method = String(data.method ?? '');
        if (method === `${sessionId}:${SESSION_RPC_METHODS.EXECUTION_RUN_WAIT}`) {
          observedRpcMethods.push(SESSION_RPC_METHODS.EXECUTION_RUN_WAIT);
          cb?.({
            ok: true,
            result: encodeBase64Rpc(encrypt(dek, 'dataKey', {
              ok: false,
              errorCode: 'RPC_METHOD_NOT_AVAILABLE',
              error: 'RPC method not available',
            }), 'base64'),
          });
          return;
        }
        if (method !== `${sessionId}:${SESSION_RPC_METHODS.EXECUTION_RUN_GET}`) return;
        observedRpcMethods.push(SESSION_RPC_METHODS.EXECUTION_RUN_GET);
        cb?.({
          ok: true,
          result: encodeBase64Rpc(encrypt(dek, 'dataKey', { run: buildRunSnapshot('succeeded') }), 'base64'),
        });
      },
    });
    bindApiSessionSocketMock(mockIo, socket);

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(['run', 'wait', sessionId, 'run_1', '--timeout', '1', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'dataKey', publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed), machineKey: machineKeySeed },
        }),
      });

      const parsed = output.json();
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.status).toBe('succeeded');
      // The order is the contract: the compatibility snapshot is a consequence
      // of the wait method being unavailable, never the first call.
      expect(observedRpcMethods).toEqual([
        SESSION_RPC_METHODS.EXECUTION_RUN_WAIT,
        SESSION_RPC_METHODS.EXECUTION_RUN_GET,
      ]);
    } finally {
      output.restore();
    }
  });

  it('returns a JSON error envelope when the observed run reports an app-level failure', async () => {
    const { handleSessionCommand } = await import('../index');

    const output = captureConsoleJsonOutput();

    const { encodeBase64: encodeBase64Rpc, encrypt } = await import('@/api/encryption');
    const socket = createApiSessionSocketStub({
      emit: (event: string, args: unknown[]) => {
        const [_data, cb] = args as [any, ((value: unknown) => void) | undefined];
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        cb?.({
          ok: true,
          result: encodeBase64Rpc(
            encrypt(new Uint8Array(32).fill(3), 'dataKey', {
              ok: false,
              errorCode: 'execution_run_not_found',
              error: 'Not found',
            }),
            'base64',
          ),
        });
      },
    });
    bindApiSessionSocketMock(mockIo, socket);

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(['run', 'wait', 'sess_integration_run_wait_123', 'run_1', '--timeout', '1', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'dataKey', publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed), machineKey: machineKeySeed },
        }),
      });

      const parsed = output.json();
      expect(parsed.ok).toBe(false);
      expect(parsed.kind).toBe('session_run_wait');
      expect(parsed.error?.code).toBe('execution_run_not_found');
    } finally {
      output.restore();
    }
  });

  it('falls back to a terminal daemon marker when the observed run reports execution_run_not_found', async () => {
    const { handleSessionCommand } = await import('../index');
    const { writeExecutionRunMarker } = await import('@/daemon/executionRunRegistry');

    await writeExecutionRunMarker({
      pid: process.pid,
      happySessionId: 'sess_integration_run_wait_123',
      runId: 'run_marker_terminal',
      callId: 'call_marker_terminal',
      sidechainId: 'call_marker_terminal',
      intent: 'delegate',
      backendTarget: { kind: 'backend', backendId: 'claude' },
      permissionMode: 'workspace_write',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
      status: 'succeeded',
      startedAtMs: 1,
      updatedAtMs: 2,
      finishedAtMs: 2,
    });

    const output = captureConsoleJsonOutput();

    const { encodeBase64: encodeBase64Rpc, encrypt } = await import('@/api/encryption');
    const socket = createApiSessionSocketStub({
      emit: (event: string, args: unknown[]) => {
        const [_data, cb] = args as [any, ((value: unknown) => void) | undefined];
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        cb?.({
          ok: true,
          result: encodeBase64Rpc(
            encrypt(new Uint8Array(32).fill(3), 'dataKey', {
              ok: false,
              errorCode: 'execution_run_not_found',
              error: 'Not found',
            }),
            'base64',
          ),
        });
      },
    });
    bindApiSessionSocketMock(mockIo, socket);

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(['run', 'wait', 'sess_integration_run_wait_123', 'run_marker_terminal', '--timeout', '1', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'dataKey', publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed), machineKey: machineKeySeed },
        }),
      });

      const parsed = output.json();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('session_run_wait');
      expect(parsed.data?.runId).toBe('run_marker_terminal');
      expect(parsed.data?.status).toBe('succeeded');
    } finally {
      output.restore();
    }
  });
});
