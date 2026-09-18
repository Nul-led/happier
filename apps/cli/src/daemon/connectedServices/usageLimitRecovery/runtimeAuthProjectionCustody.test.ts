import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { resolveSessionClientDurableMutationJournalPaths } from '@/api/session/client/transport/mutations/sessionClientDurableMutationPersistence';
import { createDaemonSessionMutationCustody } from './createDaemonUsageLimitRecoveryMutationCustody';

const paths = vi.hoisted(() => ({ directory: '' }));
// Environment configuration and HTTP are system boundaries; custody and journals remain real.
vi.mock('@/configuration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/configuration')>();
  return { ...actual, configuration: { ...actual.configuration, get activeServerDir() { return paths.directory; } } };
});

describe('runtime-auth projection custody', () => {
  it('durably retains the usage-limit projection before acknowledging transcript custody while offline', async () => {
    paths.directory = await mkdtemp(join(tmpdir(), 'runtime-auth-custody-'));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('offline'));
    const rawSession = createSessionRecordFixture({ id: 'session', metadata: '{}', encryptionMode: 'plain' });
    const custody = createDaemonSessionMutationCustody({
      credentials: { token: 'test', encryption: null },
      resolveSessionTransportContext: async () => ({
        ok: true, sessionId: 'session', rawSession, ctx: null, mode: 'plain',
        accountEncryptionCurrentness: { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' } },
      }),
    });
    try {
      await custody.stageTranscriptEvent({
        sessionId: 'session', eventId: 'scheduled-event', data: { type: 'test' },
        usageLimitRecovery: {
          v: 1, status: 'waiting', issueFingerprint: 'attempt', runtimeAuthRecoveryAttemptId: 'attempt',
          armedAtMs: 1000, resetAtMs: null, nextCheckAtMs: 31000, attemptCount: 1, maxAttempts: 3,
          lastProbeError: 'no_eligible_member', resumePromptMode: 'standard',
          selectedAuth: { kind: 'profile', serviceId: 'happier.agent.codex/openai-codex', profileId: 'only-member' },
        },
      });
      const { queuePath } = resolveSessionClientDurableMutationJournalPaths({ activeServerDir: paths.directory, sessionId: 'session', custody: 'daemon' });
      const journal = await readFile(queuePath, 'utf8');
      expect(journal).toContain('runtime.usageLimitRecovery');
      expect(journal).toContain('31000');
      expect(journal).not.toContain('recoveryIntent');
    } finally {
      await custody.close();
      vi.restoreAllMocks();
      await rm(paths.directory, { recursive: true, force: true });
    }
  });
});
