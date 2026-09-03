import { describe, expect, it } from 'vitest';

import {
  readReplaySeedV1FromMetadata,
  resolveProviderPromptWithReplaySeed,
  type DurableProviderInputAcceptanceV1,
} from './replaySeedV1';

/**
 * Everything that survives a daemon restart: the Session's persisted metadata and the
 * server-owned durable Pending delivery outcome. Nothing else crosses the restart — in
 * particular the runtime-local unsettled-retirement hold does not.
 */
type DurableSessionState = {
  metadata: any;
  acceptedPendingLocalIds: Set<string>;
  metadataWritable: boolean;
  acceptanceReadable: boolean;
};

function createDurableSessionState(): DurableSessionState {
  return {
    metadata: {
      replaySeedV1: {
        v: 1,
        seedText: 'SEED',
        sourceSessionId: 'parent',
        sourceCutoffSeqInclusive: 3,
        createdAtMs: 123,
      },
    },
    acceptedPendingLocalIds: new Set<string>(),
    metadataWritable: true,
    acceptanceReadable: true,
  };
}

/** A fresh runtime binding over the durable state: no closure survives a "restart". */
function bootRuntimeSession(state: DurableSessionState) {
  return {
    getMetadataSnapshot: () => state.metadata,
    updateMetadata: async (updater: (metadata: any) => any): Promise<void> => {
      if (!state.metadataWritable) throw new Error('metadata unavailable');
      state.metadata = updater(state.metadata);
    },
    readDurableProviderInputAcceptanceV1: async (
      localId: string,
    ): Promise<DurableProviderInputAcceptanceV1> => {
      if (!state.acceptanceReadable) return 'unknown';
      return state.acceptedPendingLocalIds.has(localId) ? 'accepted' : 'not_accepted';
    },
  };
}

async function dispatchWithSeed(
  state: DurableSessionState,
  input: Readonly<{ userText: string; localId: string; nowMs: number }>,
) {
  return await resolveProviderPromptWithReplaySeed({
    session: bootRuntimeSession(state),
    userText: input.userText,
    allowSeed: true,
    localId: input.localId,
    nowMs: input.nowMs,
    refreshMetadataBeforeRead: false,
  });
}

describe('replaySeedV1 restart reconciliation', () => {
  it('does not prefix an accepted seed to a later input after a restart lost the unsettled retirement', async () => {
    const state = createDurableSessionState();

    // Runtime #1 composes input A with the seed. The association with A's exact Pending
    // localId is the only thing that can outlive this runtime.
    const first = await dispatchWithSeed(state, { userText: 'first', localId: 'local-A', nowMs: 1 });
    expect(first.providerPrompt).toBe('SEED\n\nfirst');
    expect(first.seedApplied).toBe(true);

    // The provider accepted A and the durable Pending settlement committed.
    state.acceptedPendingLocalIds.add('local-A');

    // The replay-metadata retirement fails, so the seed is still unretired in metadata.
    state.metadataWritable = false;
    await expect(first.settleOnProviderAcceptance()).resolves.toBe('failed');
    state.metadataWritable = true;
    expect(readReplaySeedV1FromMetadata(state.metadata)?.seedText).toBe('SEED');

    // Restart: a brand new runtime/session over the same persisted state.
    const second = await dispatchWithSeed(state, { userText: 'second', localId: 'local-B', nowMs: 2 });

    expect(second.providerPrompt).toBe('second');
    expect(second.seedApplied).toBe(false);
    // Reconciliation against the durable accepted delivery retires the seed for good.
    expect(readReplaySeedV1FromMetadata(state.metadata)?.seedText).toBe('');
  });

  it('replays the seed after a restart when the provider never durably accepted the input', async () => {
    const state = createDurableSessionState();

    const first = await dispatchWithSeed(state, { userText: 'first', localId: 'local-A', nowMs: 1 });
    expect(first.providerPrompt).toBe('SEED\n\nfirst');

    // The provider rejected the input: no durable accepted delivery exists for local-A.
    state.metadataWritable = false;
    await expect(first.settleOnProviderAcceptance()).resolves.toBe('failed');
    state.metadataWritable = true;

    const second = await dispatchWithSeed(state, { userText: 'second', localId: 'local-B', nowMs: 2 });

    expect(second.providerPrompt).toBe('SEED\n\nsecond');
    expect(second.seedApplied).toBe(true);
    expect(readReplaySeedV1FromMetadata(state.metadata)?.seedText).toBe('SEED');
  });

  it('retains an unreconcilable seed instead of prefixing or destroying it', async () => {
    const state = createDurableSessionState();

    const first = await dispatchWithSeed(state, { userText: 'first', localId: 'local-A', nowMs: 1 });
    expect(first.providerPrompt).toBe('SEED\n\nfirst');
    state.metadataWritable = false;
    await expect(first.settleOnProviderAcceptance()).resolves.toBe('failed');
    state.metadataWritable = true;

    // The durable accepted delivery status cannot be read: neither prefixing nor retiring is
    // provable, so the seed is held back for this input and preserved intact.
    state.acceptanceReadable = false;
    const blocked = await dispatchWithSeed(state, { userText: 'second', localId: 'local-B', nowMs: 2 });
    expect(blocked.providerPrompt).toBe('second');
    expect(blocked.seedApplied).toBe(false);
    expect(readReplaySeedV1FromMetadata(state.metadata)?.seedText).toBe('SEED');

    // Once the durable status is readable again the retained seed still replays.
    state.acceptanceReadable = true;
    const recovered = await dispatchWithSeed(state, { userText: 'third', localId: 'local-C', nowMs: 3 });
    expect(recovered.providerPrompt).toBe('SEED\n\nthird');
  });

  it('releases the association when the composed seed is never dispatched', async () => {
    const state = createDurableSessionState();

    const first = await dispatchWithSeed(state, { userText: 'first', localId: 'local-A', nowMs: 1 });
    expect(first.providerPrompt).toBe('SEED\n\nfirst');
    // The dispatch dropped the seed before sending, so input A carries none of it.
    await first.releaseUndispatchedSeed();

    // Input A is nevertheless accepted — without the seed. The seed must survive.
    state.acceptedPendingLocalIds.add('local-A');

    const second = await dispatchWithSeed(state, { userText: 'second', localId: 'local-B', nowMs: 2 });
    expect(second.providerPrompt).toBe('SEED\n\nsecond');
    expect(readReplaySeedV1FromMetadata(state.metadata)?.seedText).toBe('SEED');
  });

  it('surfaces a failed pre-dispatch release and retains its association for later recovery', async () => {
    const state = createDurableSessionState();
    const first = await dispatchWithSeed(state, { userText: 'first', localId: 'local-A', nowMs: 1 });
    expect(readReplaySeedV1FromMetadata(state.metadata)?.dispatchedToLocalId).toBe('local-A');

    state.metadataWritable = false;
    await expect(first.releaseUndispatchedSeed()).rejects.toThrow('metadata unavailable');
    expect(readReplaySeedV1FromMetadata(state.metadata)?.dispatchedToLocalId).toBe('local-A');

    state.metadataWritable = true;
    await expect(first.releaseUndispatchedSeed()).resolves.toBeUndefined();
    expect(readReplaySeedV1FromMetadata(state.metadata)?.dispatchedToLocalId).toBeUndefined();
  });
});
