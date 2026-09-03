import type { DurableProviderInputAcceptanceV1 } from '@/agent/runtime/session/input/providerInputOutcome';
import { logger } from '@/ui/logger';

export type { DurableProviderInputAcceptanceV1 };

export type ReplaySeedV1 = {
  v: 1;
  seedText: string;
  sourceSessionId: string;
  sourceCutoffSeqInclusive: number;
  createdAtMs: number;
  appliedToLocalId?: string;
  appliedAtMs?: number;
  /**
   * The exact Pending localId whose provider prompt this seed's text was composed into,
   * recorded BEFORE the provider can accept it.
   *
   * Retirement is a separate metadata write that can fail, and the hold that retries it is
   * runtime-local. A restart therefore used to lose every trace that an already-accepted seed
   * had been handed over, and the next prompt carried the whole replay context again. This
   * association is the durable half of that fact: it names an existing Pending row, so the
   * incumbent durable accepted-delivery status for that row decides — at the next admission —
   * whether the seed is retired or still owed to the provider. It is not a second acceptance
   * fact; it records nothing about the outcome.
   */
  dispatchedToLocalId?: string;
};

const REPLAY_SEED_CONSUMED_SENTINEL_LOCAL_ID = '__replay_seed_consumed__';
const REPLAY_SEED_METADATA_REFRESH_TIMEOUT_MS = 3_000;

/**
 * Was this seed placed for a runtime that has NOT taken custody of it yet?
 *
 * Retirement is what records provider acceptance: the seed's text is blanked
 * and `appliedToLocalId` is stamped the instant the provider accepts the prompt
 * the seed was prefixed to. So an unretired seed is the durable statement that
 * the context it carries was handed over and never accepted, and that one fact
 * has two readers — the prompt owner deciding whether to prefix it again, and
 * the Agent-transition record deciding whether the departing Agent reached a
 * new transcript boundary (`REQ-STATE-03`). They share this predicate rather
 * than each re-deriving "pending" from the same three fields.
 */
export function isReplaySeedV1PendingProviderAcceptance(seed: ReplaySeedV1 | null): boolean {
  return Boolean(seed && seed.seedText && !seed.appliedToLocalId);
}

export function readReplaySeedV1FromMetadata(metadata: unknown): ReplaySeedV1 | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const seed = (metadata as any).replaySeedV1;
  if (!seed || typeof seed !== 'object') return null;
  if ((seed as any).v !== 1) return null;
  if (typeof (seed as any).seedText !== 'string') return null;
  return seed as ReplaySeedV1;
}

export function buildProviderPromptWithReplaySeed(params: Readonly<{
  metadata: unknown;
  userText: string;
  allowSeed: boolean;
}>): { providerPrompt: string; shouldConsumeSeed: boolean; seedText: string } {
  if (!params.allowSeed) {
    return { providerPrompt: params.userText, shouldConsumeSeed: false, seedText: '' };
  }

  const seed = readReplaySeedV1FromMetadata(params.metadata);
  const shouldApplySeed = isReplaySeedV1PendingProviderAcceptance(seed);
  if (!shouldApplySeed) {
    return { providerPrompt: params.userText, shouldConsumeSeed: false, seedText: '' };
  }

  return {
    providerPrompt: `${seed!.seedText}\n\n${params.userText}`,
    shouldConsumeSeed: true,
    seedText: seed!.seedText,
  };
}

export function createReplaySeedV1ConsumeUpdater(params: Readonly<{ localId: string | null; nowMs: number }>) {
  const appliedToLocalId =
    typeof params.localId === 'string' && params.localId
      ? params.localId
      : REPLAY_SEED_CONSUMED_SENTINEL_LOCAL_ID;
  return (current: any) => {
    const currentSeed = readReplaySeedV1FromMetadata(current);
    if (!currentSeed || currentSeed.appliedToLocalId) return current;
    const { dispatchedToLocalId: _retiredAssociation, ...retiredSeed } = currentSeed;
    return {
      ...(current as any),
      replaySeedV1: {
        ...retiredSeed,
        seedText: '',
        appliedToLocalId,
        appliedAtMs: params.nowMs,
      },
    };
  };
}

/**
 * Records that this seed's text was composed into the provider prompt carried by one exact
 * Pending localId. Written before dispatch, so provider acceptance always finds the
 * association already durable.
 */
export function createReplaySeedV1DispatchAssociationUpdater(params: Readonly<{ localId: string }>) {
  return (current: any) => {
    const currentSeed = readReplaySeedV1FromMetadata(current);
    if (!currentSeed || !currentSeed.seedText || currentSeed.appliedToLocalId) return current;
    if (currentSeed.dispatchedToLocalId === params.localId) return current;
    return {
      ...(current as any),
      replaySeedV1: { ...currentSeed, dispatchedToLocalId: params.localId },
    };
  };
}

/**
 * Drops the association when the composed seed never reached the provider under that localId.
 * Without this the input could still be accepted — carrying none of the seed — and
 * reconciliation would read that acceptance as proof the seed was delivered.
 */
export function createReplaySeedV1DispatchAssociationReleaseUpdater(params: Readonly<{ localId: string }>) {
  return (current: any) => {
    const currentSeed = readReplaySeedV1FromMetadata(current);
    if (!currentSeed || currentSeed.dispatchedToLocalId !== params.localId) return current;
    const { dispatchedToLocalId: _released, ...releasedSeed } = currentSeed;
    return { ...(current as any), replaySeedV1: releasedSeed };
  };
}

function hasNonEmptyMetadataSnapshot(metadata: unknown): boolean {
  return Boolean(
    metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && Object.keys(metadata as Record<string, unknown>).length > 0,
  );
}

async function waitForReplaySeedMetadataRefreshBestEffort(refresh: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      refresh.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, REPLAY_SEED_METADATA_REFRESH_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export type ReplaySeedSettlementOutcome = 'settled' | 'not_applied' | 'failed';

export type ResolvedProviderPromptWithReplaySeed = Readonly<{
  providerPrompt: string;
  seedApplied: boolean;
  seedText: string;
  /**
   * Retires the applied replay seed.
   *
   * Call this only once the provider has accepted the prompt. Composing a prompt is not
   * acceptance: several awaited steps separate composition from dispatch, and retiring the
   * seed early loses the whole replay context if any of them throws. A prompt that never
   * reaches the provider therefore keeps its seed for the next attempt.
   *
   * Settlement is idempotent per resolution and never throws; a failed metadata write is
   * reported through the returned outcome and logged, because silently swallowing it lets the
   * same seed be prefixed again on the following turn.
   */
  settleOnProviderAcceptance: () => Promise<ReplaySeedSettlementOutcome>;
  /**
   * Drops the durable dispatch association when the composed seed is abandoned before the
   * provider send. Idempotent and a no-op when no seed was applied. A failed metadata write
   * rejects and retains the association so callers cannot continue across the provider-effect
   * boundary with a plain prompt whose accepted Pending row would later retire an undelivered
   * seed.
   */
  releaseUndispatchedSeed: () => Promise<void>;
}>;

export async function resolveProviderPromptWithReplaySeed(params: Readonly<{
  session: {
    getMetadataSnapshot: () => unknown;
    updateMetadata: (updater: (metadata: any) => any) => void | Promise<void>;
    refreshSessionSnapshotFromServerBestEffort?: (opts?: { reason: 'connect' | 'waitForMetadataUpdate' }) => Promise<void>;
    ensureMetadataSnapshot?: (opts?: { timeoutMs?: number; abortSignal?: AbortSignal }) => Promise<unknown>;
    /**
     * The Pending owner's durable accepted-delivery read. Absent means this binding has no
     * durable authority to reconcile an association against, so none is recorded.
     */
    readDurableProviderInputAcceptanceV1?: (
      localId: string,
    ) => Promise<DurableProviderInputAcceptanceV1>;
  };
  userText: string;
  allowSeed: boolean;
  localId: string | null;
  nowMs: number;
  refreshMetadataBeforeRead: boolean;
}>): Promise<ResolvedProviderPromptWithReplaySeed> {
  const localMetadata = params.session.getMetadataSnapshot();
  const shouldRefreshBeforeRead = params.refreshMetadataBeforeRead && !hasNonEmptyMetadataSnapshot(localMetadata);

  if (shouldRefreshBeforeRead && typeof params.session.refreshSessionSnapshotFromServerBestEffort === 'function') {
    try {
      await waitForReplaySeedMetadataRefreshBestEffort(
        params.session.refreshSessionSnapshotFromServerBestEffort({ reason: 'waitForMetadataUpdate' }),
      );
    } catch {
      // Best-effort only; avoid blocking on snapshot refresh failures.
    }
  } else if (shouldRefreshBeforeRead && typeof params.session.ensureMetadataSnapshot === 'function') {
    try {
      await params.session.ensureMetadataSnapshot({ timeoutMs: REPLAY_SEED_METADATA_REFRESH_TIMEOUT_MS });
    } catch {
      // Best-effort only; avoid blocking on snapshot ensure failures.
    }
  }

  const readDurableAcceptance = params.session.readDurableProviderInputAcceptanceV1;
  const unseededResolution: ResolvedProviderPromptWithReplaySeed = {
    providerPrompt: params.userText,
    seedApplied: false,
    seedText: '',
    settleOnProviderAcceptance: async () => 'not_applied',
    releaseUndispatchedSeed: async () => {},
  };

  // Startup/admission reconciliation. An unretired seed that already names a Pending localId
  // was handed to the provider by some earlier resolution — possibly one whose runtime is
  // gone. The durable accepted delivery for that exact row is the only authority on whether
  // the provider took custody, so it decides here, before any decision to prefix again.
  if (params.allowSeed && typeof readDurableAcceptance === 'function') {
    const persistedSeed = readReplaySeedV1FromMetadata(params.session.getMetadataSnapshot());
    const dispatchedToLocalId = isReplaySeedV1PendingProviderAcceptance(persistedSeed)
      ? persistedSeed!.dispatchedToLocalId
      : undefined;
    if (dispatchedToLocalId) {
      let acceptance: DurableProviderInputAcceptanceV1;
      try {
        acceptance = await readDurableAcceptance(dispatchedToLocalId);
      } catch {
        acceptance = 'unknown';
      }
      if (acceptance === 'accepted') {
        // The provider already has this seed; the lost retirement is completed here.
        try {
          await params.session.updateMetadata(
            createReplaySeedV1ConsumeUpdater({ localId: dispatchedToLocalId, nowMs: params.nowMs }),
          );
        } catch (error) {
          logger.warn(
            '[replaySeedV1] Failed to retire a durably accepted replay seed at admission; it stays blocked',
            error,
          );
        }
        return unseededResolution;
      }
      if (acceptance === 'unknown') {
        // Neither prefixing nor retiring is provable. Hold the seed back for this input only:
        // it stays intact for the next admission that can read the durable status.
        return unseededResolution;
      }
      // 'not_accepted': the input was rejected, blocked or is still owed, so the seed is
      // still live and the association below simply moves to this input.
    }
  }

  const seedResolution = buildProviderPromptWithReplaySeed({
    metadata: params.session.getMetadataSnapshot(),
    userText: params.userText,
    allowSeed: params.allowSeed,
  });

  // Associate before dispatch, so provider acceptance can never outrun the durable record of
  // which Pending row carries this seed. A binding without the durable acceptance authority
  // records nothing: an association it could never reconcile would only strand the seed.
  let associatedLocalId: string | null = null;
  if (seedResolution.shouldConsumeSeed && typeof readDurableAcceptance === 'function' && params.localId) {
    try {
      await params.session.updateMetadata(
        createReplaySeedV1DispatchAssociationUpdater({ localId: params.localId }),
      );
      associatedLocalId = params.localId;
    } catch (error) {
      // Fail closed: an unassociated seed handed to the provider is exactly the duplicate this
      // association prevents, so this prompt goes out with the user's text alone.
      logger.warn(
        '[replaySeedV1] Failed to record a replay-seed dispatch association; withholding the seed',
        error,
      );
      return unseededResolution;
    }
  }

  let settled = false;
  const settleOnProviderAcceptance = async (): Promise<ReplaySeedSettlementOutcome> => {
    if (!seedResolution.shouldConsumeSeed) return 'not_applied';
    if (settled) return 'settled';
    try {
      await params.session.updateMetadata(createReplaySeedV1ConsumeUpdater({ localId: params.localId, nowMs: params.nowMs }));
      settled = true;
      return 'settled';
    } catch (error) {
      logger.warn(
        '[replaySeedV1] Failed to retire an accepted replay seed; it may be prefixed again on the next turn',
        error,
      );
      return 'failed';
    }
  };

  const releaseUndispatchedSeed = async (): Promise<void> => {
    const localId = associatedLocalId;
    if (!localId || settled) return;
    try {
      await params.session.updateMetadata(
        createReplaySeedV1DispatchAssociationReleaseUpdater({ localId }),
      );
      associatedLocalId = null;
    } catch (error) {
      logger.warn(
        '[replaySeedV1] Failed to release an undispatched replay-seed association',
        error,
      );
      throw error;
    }
  };

  return {
    providerPrompt: seedResolution.providerPrompt,
    seedApplied: seedResolution.shouldConsumeSeed,
    seedText: seedResolution.seedText,
    settleOnProviderAcceptance,
    releaseUndispatchedSeed,
  };
}
