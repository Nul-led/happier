import { describe, expect, it } from 'vitest';
import { readBuiltInLegacyConnectedAccountServiceKeyIngress } from '@happier-dev/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeAuthRecoveryScheduler, type RuntimeAuthRecoveryDiagnostic } from '../RuntimeAuthRecoveryScheduler';
import { createRecoveryIntentFileStore } from '../../recoveryScheduler/recoveryIntentFileStore';
import { buildRuntimeAuthUsageLimitRecoveryProjection } from './connectedServiceRuntimeAuthRecoveryUsageLimitMetadata';

describe('durable runtime-auth wait presentation', () => {
  it.each([null, 60_000])('publishes the actual scheduled wait with reset %s through the daemon delivery owner', async (resetsAtMs) => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-auth-projection-'));
    const diagnostics: RuntimeAuthRecoveryDiagnostic[] = [];
    let delayAtMs: number | null = null;
    const scheduler = new RuntimeAuthRecoveryScheduler({
      nowMs: () => 1_000,
      durableStore: createRecoveryIntentFileStore(join(directory, 'recovery.json')),
      recordDiagnostic: (event) => { diagnostics.push(event); },
      gate: () => delayAtMs === null ? { status: 'open' } : { status: 'delayed', retryAtMs: delayAtMs, reason: 'local_server_storm' },
      recover: async () => ({ status: 'no_eligible_member', groupExhausted: true }),
    });
    try {
      const classification = {
        kind: 'usage_limit' as const, serviceId: readBuiltInLegacyConnectedAccountServiceKeyIngress('openai-codex')!,
        profileId: 'only-member', groupId: 'pool', resetsAtMs,
        planType: null, rateLimits: null, source: 'structured_provider_error' as const,
      };
      const intake = await scheduler.beginClassifiedFailure({
        reportId: 'runtime-auth-report:test', sessionId: 'session', switchesThisTurn: 0, classification,
      });
      if (intake.status !== 'scheduled') throw new Error('Expected admitted recovery');
      const waiting = await scheduler.settleResultByKey({
        sessionId: 'session', ...classification, classificationFailureKind: classification.kind,
        expectedAttemptId: intake.attemptId,
        classificationResetsAtMs: resetsAtMs,
        result: { status: 'no_eligible_member', groupExhausted: true },
      });
      const projections: unknown[] = [];
      expect(diagnostics.some((event) => event.event === 'runtime_auth_recovery_delayed' && event.transcriptEvent)).toBe(true);
      await scheduler.drainPendingVisibleEvents(async (delivery) => {
        projections.push({ sessionUsageLimitRecoveryV1: buildRuntimeAuthUsageLimitRecoveryProjection(delivery.recoveryIntent) });
      });
      expect(projections).toEqual([expect.objectContaining({
        sessionUsageLimitRecoveryV1: expect.objectContaining({
          status: 'waiting', runtimeAuthRecoveryAttemptId: intake.attemptId,
          nextCheckAtMs: waiting?.nextRetryAtMs, resetAtMs: resetsAtMs,
          selectedAuth: { kind: 'group', serviceId: classification.serviceId, groupId: 'pool', profileId: 'only-member' },
        }),
      })]);
      expect(waiting?.nextRetryAtMs).toBeGreaterThan(1_000);
      diagnostics.length = 0;
      await scheduler.wake({ sessionId: 'session', reason: 'manual' });
      expect(diagnostics.some((event) => event.event === 'runtime_auth_recovery_delayed' && event.transcriptEvent)).toBe(true);
      await scheduler.drainPendingVisibleEvents(async () => {
        await scheduler.settleResultByKey({
          sessionId: 'session', ...classification, classificationFailureKind: classification.kind,
          expectedAttemptId: intake.attemptId,
          classificationResetsAtMs: 90_000,
          result: { status: 'no_eligible_member', groupExhausted: true },
        });
      });
      expect(await scheduler.drainPendingVisibleEvents(async () => {})).toBe(1);
      delayAtMs = 120_000;
      diagnostics.length = 0;
      await scheduler.wake({ sessionId: 'session', reason: 'manual' });
      expect(diagnostics.some((event) => event.event === 'runtime_auth_recovery_delayed' && event.transcriptEvent)).toBe(true);
      const delayedProjections: unknown[] = [];
      await scheduler.drainPendingVisibleEvents(async (delivery) => {
        delayedProjections.push({ sessionUsageLimitRecoveryV1: buildRuntimeAuthUsageLimitRecoveryProjection(delivery.recoveryIntent) });
      });
      expect(delayedProjections).toEqual([expect.objectContaining({
        sessionUsageLimitRecoveryV1: expect.objectContaining({ nextCheckAtMs: delayAtMs }),
      })]);
    } finally {
      scheduler.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
