import { describe, expect, it } from 'vitest';

import {
  ReviewCommentPublicationPlanV1Schema,
  ReviewCommentPublicationTransportRequestV1Schema,
  buildReviewCommentPublicationTransportRequestV1,
  createReviewCommentPublicationSettlementRequestV1,
  deriveAccountMachineKeyFromRecoverySecret,
  openAccountScopedBlobCiphertext,
  openReviewCommentPublicationTransportResponseV1,
  sealAccountScopedBlobCiphertext,
  type AccountScopedCryptoMaterial,
  type ReviewCommentClaimPublicationDispatchResponseV1,
  type ReviewCommentPublicationCryptoContextV1,
  type ReviewCommentPublicationPlanV1,
  type ReviewCommentPublicationResultV1,
  type ReviewCommentPublicationTransportRequestV1,
  type ReviewCommentPublicationTransportResultV1,
} from '../../index.js';

/**
 * Every private plan, snapshot, body, revision, provider reference and failure
 * string in this file carries the `CANARY` marker, so one substring assertion
 * over the serialized request covers present and future request fields alike.
 * The only plan strings that are deliberately server-readable — the canonical
 * `happierCommentId` rows the server already owns — never carry it.
 */
const CANARY = 'CANARY';
const OPAQUE_IDENTITY = /^[A-Za-z0-9_-]{43}$/;

/** Distinct bytes per call so every seal gets its own nonce. */
function countingRandomBytes(stream: number): (length: number) => Uint8Array {
  let counter = 0;
  return (length) => {
    counter += 1;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (stream * 131 + counter * 17 + index * 7) % 256;
    }
    return bytes;
  };
}

const recoverySecret = new Uint8Array(32).fill(5);
const legacyMaterial: AccountScopedCryptoMaterial = { type: 'legacy', secret: recoverySecret };
const migratedDataKeyMaterial: AccountScopedCryptoMaterial = {
  type: 'dataKey',
  machineKey: deriveAccountMachineKeyFromRecoverySecret(recoverySecret),
};
const foreignMaterial: AccountScopedCryptoMaterial = { type: 'legacy', secret: new Uint8Array(32).fill(6) };

function e2eeContext(accountId: string, material: AccountScopedCryptoMaterial): ReviewCommentPublicationCryptoContextV1 {
  return { accountId, mode: 'e2ee', material };
}

const plainContext: ReviewCommentPublicationCryptoContextV1 = {
  accountId: 'account-1',
  mode: 'plain',
  material: null,
};

function publicationEntry(happierCommentId: string, expectedServerRevision: number) {
  return {
    happierCommentId,
    expectedServerRevision,
    anchor: { kind: 'line' as const, filePath: 'CANARY-private/source.ts', line: 12 },
    snapshot: {
      kind: 'text' as const,
      selectedLines: ['CANARY-selected-code'],
      beforeContext: ['CANARY-before-context'],
      afterContext: ['CANARY-after-context'],
      selectedLinesHash: 'CANARY-selected-hash',
      contextWindowHash: 'CANARY-context-hash',
      capturedAt: 1,
      fileLength: 40,
      source: 'workingTree' as const,
      isUncommitted: true,
      isUntracked: false,
      truncated: false,
      hasBidiControls: false,
      likelyMinified: false,
    },
    body: `CANARY-review-body-${happierCommentId}`,
  };
}

function publicationPlan(overrides: Readonly<{ headRevision?: string }> = {}): ReviewCommentPublicationPlanV1 {
  return ReviewCommentPublicationPlanV1Schema.parse({
    target: {
      providerId: 'CANARY-provider',
      configuredAccountId: 'CANARY-connected-account',
      entryRef: {
        sourceId: 'CANARY-source',
        kindId: 'CANARY-entry-kind',
        collisionScope: 'CANARY-repository',
        entryId: 'CANARY-pull-request',
      },
      subtarget: { kindId: 'review-thread', targetId: 'CANARY-thread' },
    },
    baseRevision: 'CANARY-base-revision',
    headRevision: overrides.headRevision ?? 'CANARY-head-revision',
    entries: [publicationEntry('comment-1', 1), publicationEntry('comment-2', 2)],
    verdict: { kind: 'requestChanges', body: 'CANARY-verdict-body' },
  });
}

function buildClaimRequest(
  plan: ReviewCommentPublicationPlanV1,
  context: ReviewCommentPublicationCryptoContextV1,
  stream = 1,
): ReviewCommentPublicationTransportRequestV1 {
  return buildReviewCommentPublicationTransportRequestV1({
    input: plan,
    context,
    randomBytes: countingRandomBytes(stream),
  });
}

/** The exact server reply shape for a first dispatch of `request`. */
function dispatchResponse(request: ReviewCommentPublicationTransportRequestV1): unknown {
  return {
    disposition: 'dispatch',
    dispatchToken: 'dispatch-token-1',
    publicationPlanId: request.publicationPlanId,
    entries: request.entries.map(({ happierCommentId, publicationCorrelationId }) => ({
      happierCommentId,
      publicationCorrelationId,
    })),
    verdict: request.verdict,
    instructions: {
      entries: request.entries.map(() => 'dispatch'),
      verdict: request.verdict === null ? null : 'dispatch',
    },
    priorResult: null,
  };
}

/** The exact server reply shape when a settled result is replayed back to the host. */
function reconcileResponse(
  request: ReviewCommentPublicationTransportRequestV1,
  priorResult: ReviewCommentPublicationTransportResultV1 | null,
): Record<string, unknown> {
  return {
    disposition: 'reconcile',
    dispatchToken: null,
    publicationPlanId: request.publicationPlanId,
    entries: request.entries.map(({ happierCommentId, publicationCorrelationId }) => ({
      happierCommentId,
      publicationCorrelationId,
    })),
    verdict: request.verdict,
    instructions: {
      entries: request.entries.map(() => 'confirmed'),
      verdict: request.verdict === null ? null : 'confirmed',
    },
    priorResult,
  };
}

type TransportOutcome = ReviewCommentPublicationTransportResultV1['entries'][number]['outcome'];

function settlementResult(request: ReviewCommentPublicationTransportRequestV1): ReviewCommentPublicationTransportResultV1 {
  if (!request.settlement) throw new Error('expected a settlement transport request');
  return request.settlement.result;
}

function settledVerdict(result: ReviewCommentPublicationTransportResultV1) {
  if ('kind' in result.verdict) throw new Error('expected a settled verdict outcome');
  return result.verdict;
}

function encryptedCiphertext(outcome: TransportOutcome): string {
  if (outcome.content?.t !== 'encrypted') throw new Error('expected an encrypted publication outcome envelope');
  return outcome.content.c;
}

function openSealedOutcome(ciphertext: string, material: AccountScopedCryptoMaterial): unknown {
  const opened = openAccountScopedBlobCiphertext({
    kind: 'review_comment_sensitive',
    material,
    ciphertext,
  });
  if (!opened) throw new Error('expected an openable Account-scoped publication outcome envelope');
  return opened.value;
}

function claimFor(
  plan: ReviewCommentPublicationPlanV1,
  context: ReviewCommentPublicationCryptoContextV1,
  request: ReviewCommentPublicationTransportRequestV1,
): ReviewCommentClaimPublicationDispatchResponseV1 {
  return openReviewCommentPublicationTransportResponseV1({
    plan,
    context,
    response: dispatchResponse(request),
  });
}

function publishedAndFailedResult(
  claim: ReviewCommentClaimPublicationDispatchResponseV1,
): ReviewCommentPublicationResultV1 {
  return {
    publicationPlanId: claim.publicationPlanId,
    entries: [
      {
        happierCommentId: 'comment-1',
        publicationCorrelationId: claim.entries[0]!.publicationCorrelationId,
        outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
      },
      {
        happierCommentId: 'comment-2',
        publicationCorrelationId: claim.entries[1]!.publicationCorrelationId,
        outcome: { kind: 'failed', code: 'CANARY-provider-code', message: 'CANARY-provider-message' },
      },
    ],
    verdict: {
      publicationCorrelationId: claim.verdict!.publicationCorrelationId,
      outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
    },
  };
}

describe('review comment publication transport', () => {
  it('keeps the whole private plan off the E2EE claim wire behind opaque bound identities', () => {
    const plan = publicationPlan();
    const request = buildClaimRequest(plan, e2eeContext('account-1', legacyMaterial));

    expect(JSON.stringify(request)).not.toContain(CANARY);
    expect(ReviewCommentPublicationTransportRequestV1Schema.parse(request)).toEqual(request);
    expect(request.mode).toBe('e2ee');
    expect(request.contentPublicKeyFingerprint).toEqual(expect.any(String));
    expect(request.settlement).toBeUndefined();

    const identities = [
      request.targetKey,
      request.publicationPlanId,
      ...request.entries.map((entry) => entry.publicationCorrelationId),
      request.verdict!.publicationCorrelationId,
    ];
    for (const identity of identities) expect(identity).toMatch(OPAQUE_IDENTITY);
    expect(new Set(identities).size).toBe(identities.length);

    // The server keeps exactly the admission state it must arbitrate on.
    expect(request.entries).toEqual([
      { happierCommentId: 'comment-1', expectedServerRevision: 1, publicationCorrelationId: identities[2] },
      { happierCommentId: 'comment-2', expectedServerRevision: 2, publicationCorrelationId: identities[3] },
    ]);
  });

  it('binds identities to the Account and its key material and survives recovery-secret to data-key migration', () => {
    const plan = publicationPlan();
    const base = buildClaimRequest(plan, e2eeContext('account-1', legacyMaterial));

    expect(buildClaimRequest(plan, e2eeContext('account-1', legacyMaterial))).toEqual(base);
    // r0.39: publication correlations must survive Account key-representation changes.
    expect(buildClaimRequest(plan, e2eeContext('account-1', migratedDataKeyMaterial))).toEqual(base);

    const foreignAccount = buildClaimRequest(plan, e2eeContext('account-2', legacyMaterial));
    const foreignKey = buildClaimRequest(plan, e2eeContext('account-1', foreignMaterial));
    const plain = buildClaimRequest(plan, plainContext);
    for (const other of [foreignAccount, foreignKey, plain]) {
      expect(other.targetKey).not.toBe(base.targetKey);
      expect(other.publicationPlanId).not.toBe(base.publicationPlanId);
      expect(other.entries.map((entry) => entry.publicationCorrelationId))
        .not.toEqual(base.entries.map((entry) => entry.publicationCorrelationId));
      expect(other.verdict!.publicationCorrelationId).not.toBe(base.verdict!.publicationCorrelationId);
    }
    expect(foreignKey.contentPublicKeyFingerprint).not.toBe(base.contentPublicKeyFingerprint);

    // A plaintext Account publishes without any key material at all.
    expect(plain.mode).toBe('plain');
    expect(plain.contentPublicKeyFingerprint).toBeNull();
    expect(buildClaimRequest(plan, plainContext)).toEqual(plain);
    expect(JSON.stringify(plain)).not.toContain(CANARY);

    // The entry correlation is the durable duplicate-suppression marker for one
    // comment on one target, so a later plan must reuse it while the verdict
    // summary of that new review must not be confused with the earlier one.
    const replanned = buildClaimRequest(publicationPlan({ headRevision: 'CANARY-head-revision-2' }), e2eeContext('account-1', legacyMaterial));
    expect(replanned.entries.map((entry) => entry.publicationCorrelationId))
      .toEqual(base.entries.map((entry) => entry.publicationCorrelationId));
    expect(replanned.targetKey).toBe(base.targetKey);
    expect(replanned.publicationPlanId).not.toBe(base.publicationPlanId);
    expect(replanned.verdict!.publicationCorrelationId).not.toBe(base.verdict!.publicationCorrelationId);
  });

  it('fails closed when the Account mode and the supplied key material disagree', () => {
    const plan = publicationPlan();
    expect(() => buildClaimRequest(plan, { accountId: 'account-1', mode: 'e2ee', material: null }))
      .toThrow('review_comment_encryption_material_unavailable');
    expect(() => buildClaimRequest(plan, { accountId: 'account-1', mode: 'plain', material: legacyMaterial }))
      .toThrow('review_comment_encryption_mode_mismatch');
  });

  it('seals each E2EE settlement outcome in its own envelope and keeps published refs and failure text off the wire', () => {
    const plan = publicationPlan();
    const context = e2eeContext('account-1', legacyMaterial);
    const claimRequest = buildClaimRequest(plan, context);
    const claim = claimFor(plan, context, claimRequest);
    const settlement = buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(plan, claim, publishedAndFailedResult(claim)),
      context,
      randomBytes: countingRandomBytes(2),
    });

    expect(JSON.stringify(settlement)).not.toContain(CANARY);
    const result = settlementResult(settlement);
    expect(settlement.settlement!.dispatchToken).toBe('dispatch-token-1');
    expect(result.publicationPlanId).toBe(claimRequest.publicationPlanId);

    const outcomes: TransportOutcome[] = [...result.entries.map((entry) => entry.outcome), settledVerdict(result).outcome];
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['published', 'failed', 'published']);
    const ciphertexts = outcomes.map(encryptedCiphertext);
    // Two outcomes carry the same provider reference; each is still an independent envelope.
    expect(new Set(ciphertexts).size).toBe(ciphertexts.length);

    // The external-reference tag is a derived pseudonym, never the reference.
    expect(outcomes[0]!.externalRefTag).toMatch(OPAQUE_IDENTITY);
    expect(outcomes[0]!.externalRefTag).toBe(outcomes[2]!.externalRefTag);
    expect(outcomes[1]!.externalRefTag).toBeUndefined();

    expect(openSealedOutcome(ciphertexts[0]!, legacyMaterial)).toEqual({
      v: 1,
      purpose: 'publicationOutcome',
      accountId: 'account-1',
      publicationPlanId: claimRequest.publicationPlanId,
      publicationCorrelationId: claim.entries[0]!.publicationCorrelationId,
      outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
    });
    expect(openSealedOutcome(ciphertexts[1]!, legacyMaterial)).toEqual({
      v: 1,
      purpose: 'publicationOutcome',
      accountId: 'account-1',
      publicationPlanId: claimRequest.publicationPlanId,
      publicationCorrelationId: claim.entries[1]!.publicationCorrelationId,
      outcome: { kind: 'failed', code: 'CANARY-provider-code', message: 'CANARY-provider-message' },
    });
    expect(openAccountScopedBlobCiphertext({
      kind: 'review_comment_sensitive',
      material: foreignMaterial,
      ciphertext: ciphertexts[0]!,
    })).toBeNull();
  });

  it('keeps a plaintext Account settlement server-readable without any key material', () => {
    const plan = publicationPlan();
    const claimRequest = buildClaimRequest(plan, plainContext);
    const claim = claimFor(plan, plainContext, claimRequest);
    const result = publishedAndFailedResult(claim);
    const settlement = buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(plan, claim, result),
      context: plainContext,
      randomBytes: countingRandomBytes(3),
    });

    const settled = settlementResult(settlement);
    expect(settled.entries[0]!.outcome.content).toEqual({
      t: 'plain',
      v: {
        v: 1,
        purpose: 'publicationOutcome',
        accountId: 'account-1',
        publicationPlanId: claimRequest.publicationPlanId,
        publicationCorrelationId: claim.entries[0]!.publicationCorrelationId,
        outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
      },
    });
    expect(openReviewCommentPublicationTransportResponseV1({
      plan,
      context: plainContext,
      response: reconcileResponse(claimRequest, settled),
    }).priorResult).toEqual(result);
  });

  it('rejects a response whose transport binding does not match the host plan', () => {
    const plan = publicationPlan();
    const context = e2eeContext('account-1', legacyMaterial);
    const request = buildClaimRequest(plan, context);
    const response = reconcileResponse(request, null);

    expect(openReviewCommentPublicationTransportResponseV1({ plan, context, response })).toMatchObject({
      disposition: 'reconcile',
      publicationPlanId: request.publicationPlanId,
      priorResult: null,
    });

    const entries = request.entries.map(({ happierCommentId, publicationCorrelationId }) => ({
      happierCommentId,
      publicationCorrelationId,
    }));
    expect(() => openReviewCommentPublicationTransportResponseV1({
      plan,
      context,
      response: {
        ...response,
        entries: [
          { ...entries[0]!, publicationCorrelationId: entries[1]!.publicationCorrelationId },
          { ...entries[1]!, publicationCorrelationId: entries[0]!.publicationCorrelationId },
        ],
      },
    })).toThrow('review_comment_publication_binding_mismatch');

    expect(() => openReviewCommentPublicationTransportResponseV1({
      plan,
      context,
      response: { ...response, publicationPlanId: buildClaimRequest(publicationPlan({ headRevision: 'CANARY-head-revision-2' }), context).publicationPlanId },
    })).toThrow('review_comment_publication_binding_mismatch');

    expect(() => openReviewCommentPublicationTransportResponseV1({
      plan,
      context: e2eeContext('account-2', legacyMaterial),
      response,
    })).toThrow('review_comment_publication_binding_mismatch');

    expect(() => openReviewCommentPublicationTransportResponseV1({
      plan,
      context: e2eeContext('account-1', foreignMaterial),
      response,
    })).toThrow('review_comment_publication_binding_mismatch');
  });

  it('rejects replayed, swapped, retagged, unreadable and mode-switched prior outcomes', () => {
    const plan = publicationPlan();
    const context = e2eeContext('account-1', legacyMaterial);
    const request = buildClaimRequest(plan, context);
    const claim = claimFor(plan, context, request);
    const result = publishedAndFailedResult(claim);
    const settled = settlementResult(buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(plan, claim, result),
      context,
      randomBytes: countingRandomBytes(4),
    }));

    const open = (priorResult: unknown) => openReviewCommentPublicationTransportResponseV1({
      plan,
      context,
      response: { ...reconcileResponse(request, null), priorResult },
    });
    expect(open(settled).priorResult).toEqual(result);

    // A later plan for the same target reuses the entry correlation, so a prior
    // plan's envelope is a reachable replay the server could serve back.
    const otherPlan = publicationPlan({ headRevision: 'CANARY-head-revision-2' });
    const otherRequest = buildClaimRequest(otherPlan, context);
    const otherSettled = settlementResult(buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(
        otherPlan,
        claimFor(otherPlan, context, otherRequest),
        publishedAndFailedResult(claimFor(otherPlan, context, otherRequest)),
      ),
      context,
      randomBytes: countingRandomBytes(5),
    }));
    expect(otherSettled.entries[0]!.publicationCorrelationId).toBe(settled.entries[0]!.publicationCorrelationId);
    expect(() => open({
      ...settled,
      entries: [otherSettled.entries[0]!, settled.entries[1]!],
    })).toThrow('review_comment_publication_outcome_binding_mismatch');

    expect(() => open({
      ...settled,
      entries: [
        { ...settled.entries[0]!, outcome: settled.entries[1]!.outcome },
        { ...settled.entries[1]!, outcome: settled.entries[0]!.outcome },
      ],
    })).toThrow('review_comment_publication_outcome_binding_mismatch');

    expect(() => open({
      ...settled,
      entries: [
        { ...settled.entries[0]!, outcome: { ...settled.entries[0]!.outcome, externalRefTag: 'z'.repeat(43) } },
        settled.entries[1]!,
      ],
    })).toThrow('review_comment_publication_outcome_binding_mismatch');

    expect(() => open({
      ...settled,
      entries: [
        {
          ...settled.entries[0]!,
          outcome: {
            ...settled.entries[0]!.outcome,
            content: {
              t: 'encrypted',
              c: sealAccountScopedBlobCiphertext({
                kind: 'review_comment_sensitive',
                material: foreignMaterial,
                payload: {
                  v: 1,
                  purpose: 'publicationOutcome',
                  accountId: 'account-1',
                  publicationPlanId: request.publicationPlanId,
                  publicationCorrelationId: settled.entries[0]!.publicationCorrelationId,
                  outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
                },
                randomBytes: countingRandomBytes(6),
              }),
            },
          },
        },
        settled.entries[1]!,
      ],
    })).toThrow('review_comment_publication_outcome_invalid');

    expect(() => open({
      ...settled,
      entries: [
        {
          ...settled.entries[0]!,
          outcome: {
            ...settled.entries[0]!.outcome,
            content: {
              t: 'plain',
              v: {
                v: 1,
                purpose: 'publicationOutcome',
                accountId: 'account-1',
                publicationPlanId: request.publicationPlanId,
                publicationCorrelationId: settled.entries[0]!.publicationCorrelationId,
                outcome: { kind: 'published', externalRef: 'CANARY-native-comment-ref' },
              },
            },
          },
        },
        settled.entries[1]!,
      ],
    })).toThrow('review_comment_encryption_mode_mismatch');
  });

  it('re-seals a merged retry settlement independently while preserving the prior published outcome', () => {
    const plan = publicationPlan();
    const context = e2eeContext('account-1', legacyMaterial);
    const request = buildClaimRequest(plan, context);
    const firstClaim = claimFor(plan, context, request);
    const firstResult = publishedAndFailedResult(firstClaim);
    const firstSettled = settlementResult(buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(plan, firstClaim, firstResult),
      context,
      randomBytes: countingRandomBytes(7),
    }));

    const retryClaim = openReviewCommentPublicationTransportResponseV1({
      plan,
      context,
      response: {
        ...reconcileResponse(request, firstSettled),
        disposition: 'dispatch',
        dispatchToken: 'dispatch-token-2',
        instructions: { entries: ['confirmed', 'dispatch'], verdict: 'confirmed' },
      },
    });
    expect(retryClaim.priorResult).toEqual(firstResult);

    const mergedResult: ReviewCommentPublicationResultV1 = {
      ...firstResult,
      entries: [
        // The prior published outcome is carried forward verbatim, not republished.
        retryClaim.priorResult!.entries[0]!,
        {
          ...firstResult.entries[1]!,
          outcome: { kind: 'published', externalRef: 'CANARY-native-retry-ref' },
        },
      ],
    };
    const retrySettled = settlementResult(buildReviewCommentPublicationTransportRequestV1({
      input: createReviewCommentPublicationSettlementRequestV1(plan, retryClaim, mergedResult),
      context,
      randomBytes: countingRandomBytes(8),
    }));

    expect(JSON.stringify(retrySettled)).not.toContain(CANARY);
    expect(encryptedCiphertext(retrySettled.entries[0]!.outcome))
      .not.toBe(encryptedCiphertext(firstSettled.entries[0]!.outcome));
    expect(openSealedOutcome(encryptedCiphertext(retrySettled.entries[0]!.outcome), legacyMaterial))
      .toEqual(openSealedOutcome(encryptedCiphertext(firstSettled.entries[0]!.outcome), legacyMaterial));
    expect(retrySettled.entries[0]!.outcome.externalRefTag)
      .toBe(firstSettled.entries[0]!.outcome.externalRefTag);
    expect(retrySettled.entries[1]!.outcome.externalRefTag)
      .not.toBe(firstSettled.entries[0]!.outcome.externalRefTag);

    expect(openReviewCommentPublicationTransportResponseV1({
      plan,
      context,
      response: reconcileResponse(request, retrySettled),
    }).priorResult).toEqual(mergedResult);
  });
});
