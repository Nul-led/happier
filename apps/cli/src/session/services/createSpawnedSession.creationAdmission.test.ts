import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createSocketTransportAdapter } from '@happier-dev/sync-client';
import axios from 'axios';

import {
  buildSessionSpawnInitialInputLocalIdV1,
  deriveSessionCreationTagV1,
  SessionCreationCorrespondenceV1Schema,
  SPAWN_SESSION_ERROR_CODES,
} from '@happier-dev/protocol';
import { createSpawnedSession } from './createSpawnedSession';
import { buildSessionSpawnInitialInputAdmissionForLocalIdV1 } from './sessionInputAdmissionIdentity';

// Only HTTP/authentication and exact-machine transport boundaries are replaced;
// lookup decoding, creation settlement and Message admission remain real.
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('@/auth/validateStoredAuthTokenAgainstActiveServer', () => ({
  validateStoredAuthTokenAgainstActiveServer: vi.fn(async () => ({ state: 'valid' })),
}));
const fetchSessionById = vi.hoisted(() => vi.fn());
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
  fetchSessionById,
}));
const fetchAccountEncryptionCurrentness = vi.hoisted(() => vi.fn());
vi.mock('@/api/client/connectedServiceCredentialApi', () => ({ fetchAccountEncryptionCurrentness }));
const socketBoundary = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/api/session/sockets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/session/sockets')>(),
  createUserScopedSocketConnection: () => {
    const socket = socketBoundary.create();
    return { socket, transport: createSocketTransportAdapter(socket) };
  },
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const sessionCreationTag = deriveSessionCreationTagV1({ callerCreationNamespace: 'user', creationKey: 'admission-test' });
const sessionCreationCorrespondence = SessionCreationCorrespondenceV1Schema.parse({
  v: 1,
  sessionCreationTag,
  recipe: {
    execution: { machineId: 'machine-1', directory: { kind: 'path', path: '/repo' } },
    organization: { folderId: null, tagIds: [] },
    agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
    modelSelection: null, profileId: null, requestedPermissionMode: null, agentModeId: null,
    configuration: null, connectedServices: null, mcpSelection: null, transcriptStorage: null,
    terminal: null, agentSessionStartupInstructionsMarkerV1: null, checkout: null,
  },
});

describe('canonical Session creation admission', () => {
  const spawn = vi.fn();
  const resolveSpawnSessionByNonce = vi.fn();
  const params = {
    credentials: { token: 'test-token', encryption: null },
    directory: '/repo', machineId: 'machine-1',
    agentTarget: sessionCreationCorrespondence.recipe.agentTarget,
    sessionCreationTag, sessionCreationCorrespondence,
    directTransport: { spawn, resolveSpawnSessionByNonce },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    socketBoundary.create.mockReturnValue(Object.assign(new EventEmitter(), {
      connected: false, connect: vi.fn(), disconnect: vi.fn(), close: vi.fn(),
    }));
    vi.mocked(axios.post).mockResolvedValue({ status: 200, data: { sessions: [] } });
    spawn.mockResolvedValue({
      success: true, sessionId: 'session-created',
      sessionCreationOutcome: { disposition: 'created', organizationPlacement: { folderId: null, tagIds: [] } },
    });
    fetchSessionById.mockResolvedValue({
      id: 'session-created', createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
      metadataVersion: 1, metadataLayoutVersion: 1, encryptionMode: 'plain', metadata: JSON.stringify({ v: 1 }),
    });
    fetchAccountEncryptionCurrentness.mockRejectedValue(new Error('Account currentness unavailable'));
  });

  it('refuses a recognized unavailable tag lookup before any provider spawn', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 404,
      data: { statusCode: 404, error: 'Not Found', message: 'Route POST:/v2/sessions/lookup-by-tags not found' },
    });
    await expect(createSpawnedSession(params)).rejects.toMatchObject({ code: SPAWN_SESSION_ERROR_CODES.DAEMON_RPC_UNAVAILABLE });
    expect(spawn).not.toHaveBeenCalled();
    expect(resolveSpawnSessionByNonce).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves fresh committed creation with truthful nested input when currentness is unavailable (input=%s)', async (withInput) => {
    const result = await createSpawnedSession({
      ...params,
      ...(withInput ? {
        initialInput: { text: 'Hello' },
        buildInitialInputHandoff: (localId: string) => buildSessionSpawnInitialInputAdmissionForLocalIdV1({
          actionCaller: { kind: 'host' }, callerSurface: 'cli', localId,
        }),
      } : {}),
    });
    expect(result).toMatchObject({
      sessionId: 'session-created', disposition: 'created',
      initialInput: withInput
        ? { status: 'outcomeUnknown', localId: buildSessionSpawnInitialInputLocalIdV1({ sessionCreationTag }), code: 'session_input_action_execution_failed' }
        : { status: 'notRequested' },
    });
  });

  it('still refuses an unauthenticated rejoined Session after spawn settlement', async () => {
    spawn.mockResolvedValue({
      success: true, sessionId: 'session-created',
      sessionCreationOutcome: { disposition: 'rejoined', organizationPlacement: { folderId: null, tagIds: [] } },
    });
    await expect(createSpawnedSession(params)).rejects.toMatchObject({ code: 'SESSION_WEBHOOK_TIMEOUT' });
  });

  it('parks known Session visibility and re-reads it after reconnect', async () => {
    vi.useFakeTimers();
    const session = await fetchSessionById();
    fetchSessionById.mockClear();
    fetchSessionById.mockResolvedValue(null);
    const result = createSpawnedSession(params);
    await vi.advanceTimersByTimeAsync(0);
    const baselineReads = fetchSessionById.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSessionById).toHaveBeenCalledTimes(baselineReads);
    fetchSessionById.mockResolvedValue(session);
    const socket = socketBoundary.create.mock.results[0]?.value;
    socket.emit('connect');
    await expect(result).resolves.toMatchObject({ sessionId: 'session-created', disposition: 'created' });
    expect(socket.eventNames()).toEqual([]);
  });
});
