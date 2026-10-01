import type { Metadata } from '@/api/types';
import { logger } from '@/ui/logger';
import { isRuntimeConfigUpdateOutcomeApplied, type RuntimeConfigUpdateOutcomeV1 } from '@happier-dev/agents';

import { computePendingSessionModeOverrideApplication } from './permissions/modeFromMetadata';

export function createSessionModeOverrideSynchronizer(params: Readonly<{
  session: { getMetadataSnapshot: () => Metadata | null };
  runtime: { setSessionMode: (modeId: string) => Promise<RuntimeConfigUpdateOutcomeV1 | void> };
  isStarted: () => boolean;
}>): {
  syncFromMetadata: () => void;
  flushPendingAfterStart: () => Promise<void>;
} {
  let lastAppliedUpdatedAt = 0;
  let pending: { modeId: string; updatedAt: number } | null = null;
  let applyingPromise: Promise<void> | null = null;
  let lastAttemptedUpdatedAt = 0;
  let lastAttemptNumber = 0;

  const applyPendingIfPossible = (): Promise<void> => {
    if (applyingPromise) return applyingPromise;
    if (!pending) return Promise.resolve();
    if (!params.isStarted()) return Promise.resolve();

    const next = pending;
    if (next.modeId.trim().length === 0) {
      lastAppliedUpdatedAt = next.updatedAt;
      if (pending && pending.updatedAt <= lastAppliedUpdatedAt) pending = null;
      return Promise.resolve();
    }

    const runtimeModeId = next.modeId;
    const attempt =
      next.updatedAt === lastAttemptedUpdatedAt
        ? lastAttemptNumber + 1
        : 1;
    if (next.updatedAt <= lastAppliedUpdatedAt) {
      pending = null;
      return Promise.resolve();
    }
    lastAttemptedUpdatedAt = next.updatedAt;
    lastAttemptNumber = attempt;
    logger.debug('[SessionModeOverrideSync] Applying session mode override', {
      modeId: runtimeModeId,
      updatedAt: next.updatedAt,
      attempt,
    });

    const reportNotApplied = (): void => {
      // Native modes and rejection details can contain private provider data.
      logger.infoFile('[SessionModeOverrideSync] Session mode override not applied; will retry on next sync', {
        updatedAt: next.updatedAt,
        attempt,
      });
    };
    applyingPromise = params.runtime
      .setSessionMode(runtimeModeId)
      .then((outcome) => {
        if (!isRuntimeConfigUpdateOutcomeApplied(outcome)) {
          reportNotApplied();
          return;
        }
        // Only advance lastAppliedUpdatedAt on success so failures can retry.
        lastAppliedUpdatedAt = next.updatedAt;
        if (pending && pending.updatedAt <= lastAppliedUpdatedAt) pending = null;
      })
      .catch(reportNotApplied)
      .finally(() => {
        applyingPromise = null;
        if (pending && pending.updatedAt > next.updatedAt && params.isStarted()) {
          void applyPendingIfPossible();
        }
      });

    return applyingPromise;
  };

  const syncFromMetadata = (): void => {
    const snapshot = params.session.getMetadataSnapshot();
    const next = computePendingSessionModeOverrideApplication({
      metadata: snapshot,
      lastAppliedUpdatedAt,
    });
    if (!next) return;

    if (!params.isStarted()) {
      pending = next;
      return;
    }

    pending = next;
    void applyPendingIfPossible();
  };

  const flushPendingAfterStart = async (): Promise<void> => {
    if (!pending) return;
    if (!params.isStarted()) return;

    const next = pending;
    if (next.updatedAt <= lastAppliedUpdatedAt) return;
    await applyPendingIfPossible();
  };

  return { syncFromMetadata, flushPendingAfterStart };
}

export const createAcpSessionModeOverrideSynchronizer = createSessionModeOverrideSynchronizer;
