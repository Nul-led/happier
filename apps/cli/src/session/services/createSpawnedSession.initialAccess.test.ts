import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpawnedSession } from './createSpawnedSession';
import type { SpawnDaemonSessionRequest } from '@/rpc/handlers/spawnSessionOptionsContract';
import axios from 'axios';
import { deriveSessionCreationTagV1, SessionCreationKeyV1Schema } from '@happier-dev/protocol';
import { createCliActionDeps } from '@/session/actions/createCliActionDeps';
import { configuration } from '@/configuration';

describe('fresh spawn initial access transport', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('carries grants and personal context to the exact daemon without embedding them in environment or identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'owner' }))));
    const initialAccess = {
      grants: [{ subject: { kind: 'team' as const, teamId: 'team-1' }, accessLevel: 'edit' as const, canApprovePermissions: false }],
    };
    const transportFailure = new Error('transport unavailable');
    let observed: SpawnDaemonSessionRequest | undefined;
    await expect(createSpawnedSession({
      credentials: { token: 'token', encryption: null },
      directory: '/workspace',
      initialAccess,
      primaryTeamId: null,
      directTransport: {
        // The daemon transport is a real process boundary; all request construction stays real.
        spawn: async (request) => { observed = request; throw transportFailure; },
        resolveSpawnSessionByNonce: async () => ({ status: 'not_found' }),
      },
    })).rejects.toBe(transportFailure);
    expect(observed).toMatchObject({ initialAccess, primaryTeamId: null });
    expect(observed?.environmentVariables).toBeUndefined();
    expect(observed?.sessionCreationCorrespondence).toBeUndefined();
  });

  it('carries Action authoring access through real creation to the daemon boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'owner' }))));
    vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { sessions: [] } });
    const initialAccess = { grants: [{ subject: { kind: 'team' as const, teamId: 'team-1' }, accessLevel: 'view' as const, canApprovePermissions: false }] };
    let observed: SpawnDaemonSessionRequest | undefined;
    const deps = createCliActionDeps({
      token: 'token', credentials: { token: 'token', encryption: null },
      sessionId: 'parent', mode: 'plain', ctx: null,
      sessionSpawnDirectTargetTransport: {
        machineId: 'machine-1',
        prepare: async () => ({ ok: true, directory: '/workspace', directoryKind: 'path', directoryCreationRequired: false, checkout: null }),
        spawnedSession: {
          spawn: async (request) => { observed = request; throw new Error('transport unavailable'); },
          resolveSpawnSessionByNonce: async () => ({ status: 'not_found' }),
        },
      },
    });
    await deps.sessionSpawnNew({
      creationKey: SessionCreationKeyV1Schema.parse('access-authoring'),
      sessionCreationTag: deriveSessionCreationTagV1({ callerCreationNamespace: 'user', creationKey: 'access-authoring' }),
      executionTarget: { serverId: 'home', machineId: 'machine-1' },
      directory: { kind: 'path', path: '/workspace' },
      agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
      connectedServices: { v: 2, bindingsByServiceId: {} },
      actionCaller: { kind: 'host' },
      initialAccess,
      primaryTeamId: 'team-1',
    });
    expect(observed).toMatchObject({ initialAccess, primaryTeamId: 'team-1' });
    expect(observed?.sessionCreationCorrespondence?.recipe).not.toHaveProperty('initialAccess');
    expect(observed?.sessionCreationCorrespondence?.recipe).not.toHaveProperty('primaryTeamId');
  });

  it('preserves canonical terminal detail when a pending spawn resolves to a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'owner' }))));
    const errorDetail = { kind: 'session_creation_organization_invalid' as const, code: 'organization_invalid' as const };
    await expect(createSpawnedSession({
      credentials: { token: 'token', encryption: null }, directory: '/workspace', spawnNonce: 'pending-create',
      directTransport: {
        spawn: async () => ({ success: true, status: 'pending', spawnNonce: 'pending-create' }),
        resolveSpawnSessionByNonce: async () => ({
          status: 'error', errorCode: 'SPAWN_VALIDATION_FAILED', errorMessage: 'Rejected', errorDetail,
        }),
      },
    })).rejects.toMatchObject({ details: { errorDetail } });
  });

  it('reports the exact daemon update requirement before dispatch to an unsupported peer', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { machine: {
      id: 'old-daemon', revokedAt: null, replacedByMachineId: null,
      operationProtocolCapabilities: {}, operationProtocolCapabilitiesRevision: 1,
    } } });
    const post = vi.spyOn(axios, 'post');
    const deps = createCliActionDeps({ token: 'token', credentials: { token: 'token', encryption: null }, sessionId: 'parent', mode: 'plain', ctx: null });
    const result = await deps.sessionSpawnNew({
      creationKey: SessionCreationKeyV1Schema.parse('old-daemon-access'),
      sessionCreationTag: deriveSessionCreationTagV1({ callerCreationNamespace: 'user', creationKey: 'old-daemon-access' }),
      executionTarget: { serverId: configuration.activeServerId, machineId: 'old-daemon' },
      directory: { kind: 'path', path: '/workspace' },
      agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
      actionCaller: { kind: 'host' },
      initialAccess: { grants: [] },
    });
    expect(result).toEqual({ type: 'error', code: 'update_required', retryable: false, details: {
      kind: 'update_required', operation: 'session.spawn_new', component: 'daemon', reason: 'session_initial_access_update_required',
    } });
    expect(post).not.toHaveBeenCalled();
  });
});
