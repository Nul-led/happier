import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredCredentials } from '@/persistence';

const readDaemonPluginCatalog = vi.fn();
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({ default: { get, post } }));

vi.mock('@/daemon/controlClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/daemon/controlClient')>(),
  readDaemonPluginCatalog: (...args: unknown[]) => readDaemonPluginCatalog(...args),
}));

import { callBuiltInHappierTool } from './callBuiltInHappierTool';

function storedSessionCredentials(token: string): StoredCredentials {
  return {
    token,
    encryption: null,
    credentialProvenance: 'stored_session',
  } as StoredCredentials;
}

describe('callBuiltInHappierTool one-shot CLI credential fence', () => {
  const sessionId = 'c123456789012345678901234';

  beforeEach(() => {
    vi.resetAllMocks();
    post.mockRejectedValue(new Error('physical Lane 06 transport reached'));
    get.mockImplementation(async (url: string) => url.endsWith('/v1/account/encryption/currentness')
      ? {
          status: 200,
          data: {
            mode: 'plain',
            version: 1,
            signingKeyFingerprint: null,
            contentKeyFingerprint: null,
            updatedAt: 1,
            recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' },
          },
        }
      : {
          status: 200,
          data: {
            session: {
              id: sessionId,
              seq: 1,
              createdAt: 1,
              updatedAt: 1,
              active: true,
              activeAt: 1,
              encryptionMode: 'plain',
              metadata: '{}',
              metadataVersion: 1,
              agentState: null,
              agentStateVersion: 0,
              dataEncryptionKey: null,
              machineId: 'machine-1',
            },
          },
        });
    readDaemonPluginCatalog.mockResolvedValue({ kind: 'unavailable', code: 'test_daemon_unavailable' });
  });

  it('settles an already-rotated credential before any session or Action transport', async () => {
    const initial = storedSessionCredentials('hap_v1_initial');
    const rotated = storedSessionCredentials('hap_v1_rotated');
    await expect(callBuiltInHappierTool({
      credentials: initial,
      sessionId,
      toolName: 'action_execute',
      args: {
        actionId: 'session.access.grant.set',
        input: {
          sessionId,
          principal: { kind: 'account', accountId: 'recipient-1' },
          level: 'edit',
        },
      },
      surface: 'cli',
      readCredentials: vi.fn(async () => rotated),
    })).resolves.toEqual({
      ok: false,
      errorCode: 'not_authenticated',
      error: 'not_authenticated',
    });

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  }, 120_000);

  it('uses the canonical executor currentness fence when credentials rotate after session resolution', async () => {
    const initial = storedSessionCredentials('hap_v1_initial');
    const rotated = storedSessionCredentials('hap_v1_rotated');
    const readCredentials = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(rotated);

    await expect(callBuiltInHappierTool({
      credentials: initial,
      sessionId,
      toolName: 'action_execute',
      args: {
        actionId: 'session.access.grant.set',
        input: {
          sessionId,
          principal: { kind: 'account', accountId: 'recipient-1' },
          level: 'edit',
        },
      },
      surface: 'cli',
      readCredentials,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'not_authenticated',
      error: 'not_authenticated',
    });

    expect(readCredentials).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  }, 120_000);

});
