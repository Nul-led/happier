import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovalRequestSchema,
  ApprovalRequestV2Schema,
  createActionExecutor,
  type ActionExecutorDeps,
  type ApprovalExecutionOriginV1,
  type ApprovalRequest,
} from '@happier-dev/protocol';
import { libsodiumPublicKeyFromSecretKey } from '@/api/encryption';
import type { Credentials } from '@/persistence';

import { createCliApprovalsArtifactStore } from './artifactStore';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: mockGet,
    post: mockPost,
  },
}));

vi.mock('@/configuration', () => ({
  configuration: {
    apiServerUrl: 'http://127.0.0.1:24599',
  },
}));

type StoredArtifact = {
  id: string;
  header: string;
  headerVersion: number;
  body: string;
  bodyVersion: number;
  dataEncryptionKey: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
};

describe('approval Artifact cross-device decision', () => {
  let artifacts: Map<string, StoredArtifact>;

  beforeEach(() => {
    artifacts = new Map();
    mockGet.mockReset();
    mockPost.mockReset();

    mockGet.mockImplementation(async (url: string) => {
      const artifactId = decodeURIComponent(url.split('/').at(-1) ?? '');
      const artifact = artifacts.get(artifactId);
      return artifact
        ? { status: 200, data: artifact }
        : { status: 404, data: { error: 'not_found' } };
    });
    mockPost.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url.endsWith('/v1/artifacts')) {
        const id = String(body.id);
        artifacts.set(id, {
          id,
          header: String(body.header),
          headerVersion: 1,
          body: String(body.body),
          bodyVersion: 1,
          dataEncryptionKey: String(body.dataEncryptionKey),
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        return { status: 200, data: { id } };
      }

      const artifactId = decodeURIComponent(url.split('/').at(-1) ?? '');
      const current = artifacts.get(artifactId);
      if (!current) return { status: 404, data: { error: 'not_found' } };
      if (
        body.expectedHeaderVersion !== current.headerVersion
        || body.expectedBodyVersion !== current.bodyVersion
      ) {
        return { status: 200, data: { success: false, error: 'version-mismatch' } };
      }
      const next: StoredArtifact = {
        ...current,
        header: String(body.header),
        headerVersion: current.headerVersion + 1,
        body: String(body.body),
        bodyVersion: current.bodyVersion + 1,
        seq: current.seq + 1,
        updatedAt: current.updatedAt + 1,
      };
      artifacts.set(artifactId, next);
      return {
        status: 200,
        data: {
          success: true,
          headerVersion: next.headerVersion,
          bodyVersion: next.bodyVersion,
        },
      };
    });
  });

  it('decides a creator-profile artifact from another profile on the same Home exactly once', async () => {
    const machineKey = new Uint8Array(32).fill(7);
    const credentials: Credentials = {
      token: 'account-token',
      encryption: {
        type: 'dataKey',
        machineKey,
        publicKey: libsodiumPublicKeyFromSecretKey(machineKey),
      },
    };
    const store = createCliApprovalsArtifactStore({
      credentials,
      getAccountEncryptionMode: async () => 'e2ee',
    });
    const creatorProfileId = 'profile-creator-a';
    const decidingProfileId = 'profile-decider-b';
    const stableHomeId = 'srv_shared_home';
    const request = ApprovalRequestV2Schema.parse({
      v: 2,
      status: 'open',
      createdAtMs: 100,
      updatedAtMs: 100,
      createdBy: { surface: 'mcp', sessionId: 'session-1' },
      executionOriginV1: {
        v: 1,
        authority: 'account_automation',
        surface: 'mcp',
        caller: { kind: 'host' },
        accountId: 'account-1',
        serverId: creatorProfileId,
        serverIdentityId: stableHomeId,
        machineId: 'machine-1',
        sessionId: 'session-1',
        target: { kind: 'session', sessionId: 'session-1' },
        actionId: 'session.title.set',
        requestId: 'request-1',
      },
      actionId: 'session.title.set',
      actionArgs: { sessionId: 'session-1', title: 'Cross-device approval' },
      summary: 'Set title',
    });
    const created = await store.approvalsCreate({ request, serverId: creatorProfileId });
    const sessionTitleSet = vi.fn(async () => ({ updated: true }));
    const executor = createActionExecutor({
      ...store,
      sessionTitleSet,
      isApprovalExecutionOriginCurrent: async ({ origin }: Readonly<{ origin: ApprovalExecutionOriginV1 }>) => (
        origin.serverIdentityId === stableHomeId
        && origin.accountId === 'account-1'
        && origin.machineId === 'machine-1'
      ),
    } as unknown as ActionExecutorDeps);

    const decide = (
      artifactId: string,
      originServerId: string,
      serverIdentityId: string,
      observedServerIdentityId = stableHomeId,
    ) => executor.execute(
      'approval.request.decide',
      {
        artifactId,
        decision: 'approve',
        originServerId,
        serverIdentityId,
      },
      {
        surface: 'ui',
        authority: 'present_user',
        serverId: decidingProfileId,
        serverIdentityId: observedServerIdentityId,
      },
    );

    await expect(decide(created.artifactId, creatorProfileId, stableHomeId)).resolves.toMatchObject({
      ok: true,
      result: { status: 'executed', execution: { ok: true } },
    });
    await expect(decide(created.artifactId, creatorProfileId, stableHomeId)).resolves.toMatchObject({
      ok: true,
      result: { status: 'executed', execution: { ok: true } },
    });
    expect(sessionTitleSet).toHaveBeenCalledOnce();

    const persisted = await store.approvalsGet({
      artifactId: created.artifactId,
      serverId: decidingProfileId,
    });
    expect(persisted?.status).toBe('executed');
    expect((persisted as Extract<ApprovalRequest, { v: 2 }>).executionOriginV1).toMatchObject({
      serverId: creatorProfileId,
      serverIdentityId: stableHomeId,
    });

    const staleRequest = ApprovalRequestV2Schema.parse({
      ...request,
      executionOriginV1: {
        ...request.executionOriginV1,
        requestId: 'request-stale-origin-1',
      },
      actionArgs: { sessionId: 'session-1', title: 'Must not execute' },
    });
    const staleCreated = await store.approvalsCreate({
      request: staleRequest,
      serverId: creatorProfileId,
    });
    const writesBeforeStaleDecision = mockPost.mock.calls.length;
    await expect(decide(staleCreated.artifactId, 'wrong-creator', stableHomeId)).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'failed',
        execution: { ok: false, errorCode: 'approval_stale' },
      },
    });
    expect(mockPost).toHaveBeenCalledTimes(writesBeforeStaleDecision + 2);
    expect(sessionTitleSet).toHaveBeenCalledOnce();

    // A second decider observes the same terminal artifact; it cannot execute
    // the Action or reopen the approval even with the now-correct target.
    await expect(decide(staleCreated.artifactId, creatorProfileId, stableHomeId)).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'failed',
        execution: { ok: false, errorCode: 'approval_stale' },
      },
    });
    expect(mockPost).toHaveBeenCalledTimes(writesBeforeStaleDecision + 2);
    expect(sessionTitleSet).toHaveBeenCalledOnce();

    const persistedStale = await store.approvalsGet({
      artifactId: staleCreated.artifactId,
      serverId: decidingProfileId,
    });
    expect(persistedStale).toMatchObject({
      status: 'failed',
      execution: { ok: false, errorCode: 'approval_stale' },
    });
  });

  it('persists the terminal stale result for a released V1 approval without executing it', async () => {
    const machineKey = new Uint8Array(32).fill(8);
    const store = createCliApprovalsArtifactStore({
      credentials: {
        token: 'account-token',
        encryption: {
          type: 'dataKey',
          machineKey,
          publicKey: libsodiumPublicKeyFromSecretKey(machineKey),
        },
      },
      getAccountEncryptionMode: async () => 'e2ee',
    });
    const request = ApprovalRequestSchema.parse({
      v: 1,
      status: 'open',
      createdAtMs: 100,
      updatedAtMs: 100,
      createdBy: { surface: 'mcp', sessionId: 'session-1' },
      actionId: 'session.title.set',
      actionArgs: { sessionId: 'session-1', title: 'Must not execute' },
      summary: 'Set title',
      serverId: 'profile-creator-a',
    });
    const created = await store.approvalsCreate({ request, serverId: 'profile-creator-a' });
    const sessionTitleSet = vi.fn(async () => ({ updated: true }));
    const executor = createActionExecutor({ ...store, sessionTitleSet } as unknown as ActionExecutorDeps);

    await expect(executor.execute(
      'approval.request.decide',
      { artifactId: created.artifactId, decision: 'approve' },
      { surface: 'ui', authority: 'present_user', serverId: 'profile-creator-a' },
    )).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'failed',
        execution: { ok: false, errorCode: 'approval_stale' },
      },
    });
    expect(sessionTitleSet).not.toHaveBeenCalled();
    await expect(store.approvalsGet({
      artifactId: created.artifactId,
      serverId: 'profile-creator-a',
    })).resolves.toMatchObject({
      status: 'failed',
      execution: { ok: false, errorCode: 'approval_stale' },
    });
  });
});
