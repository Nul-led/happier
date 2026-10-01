import { SPAWN_SESSION_ERROR_CODES, type SpawnSessionResult } from '@/session/shared/spawnSessionContract';
import type { PersistedTakeoverAdmissionWaitRegistration } from './persistedTakeoverAdmission';

/** Returns null when launch may commit, otherwise the exact refusal to return without creating a child. */
export type SpawnCommitRevalidation = () => Promise<SpawnSessionResult | null>;

/** Compose cancellation with the existing final launch fence, including awaited provider checks. */
export function withTakeoverAdmissionCommitRevalidation(
  admission: PersistedTakeoverAdmissionWaitRegistration | undefined,
  revalidate: SpawnCommitRevalidation | undefined,
): SpawnCommitRevalidation | undefined {
  if (!admission) return revalidate;
  const cancellation = (): SpawnSessionResult | null =>
    admission.readOutcome()?.status === 'failed'
      ? {
          type: 'error',
          errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
          errorMessage: 'Takeover admission was cancelled before launch',
        }
      : null;
  return async () => {
    const before = cancellation();
    if (before) return before;
    const refusal = await revalidate?.() ?? null;
    return refusal ?? cancellation();
  };
}
