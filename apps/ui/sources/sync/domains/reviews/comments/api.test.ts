import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ReviewCommentPublicationTransportRequestV1Schema,
    createReviewCommentPublicationSettlementRequestV1,
    type AccountScopedCryptoMaterial,
    type ReviewCommentClaimPublicationDispatchResponseV1,
    type ReviewCommentPublicationPlanV1,
    type ReviewCommentPublicationTransportRequestV1,
    type ReviewCommentV1,
} from '@happier-dev/protocol';

const serverFetchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchSpy,
}));

/**
 * Every private plan string carries `PRIVATE-`, so one substring sweep over the
 * bytes `serverFetch` actually received covers present and future request
 * fields. `happierCommentId` is excluded: the Happier server owns that row.
 */
const publicationPlan: ReviewCommentPublicationPlanV1 = {
    target: {
        providerId: 'PRIVATE-provider',
        configuredAccountId: 'PRIVATE-connected-account',
        entryRef: {
            sourceId: 'PRIVATE-source',
            kindId: 'PRIVATE-entry-kind',
            collisionScope: 'PRIVATE-repository',
            entryId: 'PRIVATE-pull-request',
        },
        subtarget: null,
    },
    baseRevision: 'PRIVATE-base-revision',
    headRevision: 'PRIVATE-head-revision',
    entries: [{
        happierCommentId: 'comment-1',
        expectedServerRevision: 1,
        anchor: { kind: 'line', filePath: 'PRIVATE-source/file.ts', line: 4 },
        snapshot: {
            kind: 'text',
            selectedLines: ['PRIVATE-selected-code'],
            beforeContext: ['PRIVATE-before-context'],
            afterContext: ['PRIVATE-after-context'],
            selectedLinesHash: 'PRIVATE-selected-hash',
            contextWindowHash: 'PRIVATE-context-hash',
            capturedAt: 1,
            fileLength: 5,
            source: 'workingTree',
            isUncommitted: true,
            isUntracked: false,
            truncated: false,
            hasBidiControls: false,
            likelyMinified: false,
        },
        body: 'PRIVATE-review-body',
    }],
    verdict: { kind: 'comment', body: 'PRIVATE-verdict-body' },
};

const e2eeMaterial: AccountScopedCryptoMaterial = { type: 'legacy', secret: new Uint8Array(32).fill(5) };

/** Distinct bytes per call so every seal gets its own nonce. */
function countingRandomBytes(): (length: number) => Uint8Array {
    let counter = 0;
    return (length) => {
        counter += 1;
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) bytes[index] = (counter * 17 + index * 7) % 256;
        return bytes;
    };
}

function postedTransportRequest(callIndex: number): ReviewCommentPublicationTransportRequestV1 {
    const init = serverFetchSpy.mock.calls[callIndex]?.[1] as RequestInit | undefined;
    return ReviewCommentPublicationTransportRequestV1Schema.parse(JSON.parse(String(init?.body)));
}

function publicationResponseFor(body: unknown, settled: boolean): unknown {
    const request = ReviewCommentPublicationTransportRequestV1Schema.parse(JSON.parse(String(body)));
    return {
        disposition: settled ? 'reconcile' : 'dispatch',
        dispatchToken: settled ? null : 'dispatch-token-1',
        publicationPlanId: request.publicationPlanId,
        entries: request.entries.map(({ happierCommentId, publicationCorrelationId }) => ({
            happierCommentId,
            publicationCorrelationId,
        })),
        verdict: request.verdict,
        instructions: {
            entries: request.entries.map(() => settled ? 'confirmed' : 'dispatch'),
            verdict: request.verdict === null ? null : settled ? 'confirmed' : 'dispatch',
        },
        priorResult: request.settlement?.result ?? null,
    };
}

function comment(overrides: Partial<ReviewCommentV1> = {}): ReviewCommentV1 {
    return {
        v: 1,
        id: overrides.id ?? 'comment-1',
        accountId: 'account-1',
        projectId: overrides.projectId ?? 'project-1',
        workspaceId: overrides.workspaceId,
        runId: overrides.runId,
        engineId: overrides.engineId,
        anchor: overrides.anchor ?? { kind: 'file', filePath: 'src/a.ts' },
        snapshot: { kind: 'too_large', filePath: 'src/a.ts', sizeBytes: 2, capBytes: 1, capturedAt: 1 },
        body: overrides.body ?? 'body',
        bodyVersion: 1,
        edits: [],
        author: overrides.author ?? { kind: 'plugin', pluginId: 'review-coderabbit' },
        state: overrides.state ?? 'open',
        flags: overrides.flags ?? {},
        dispositions: {},
        threadId: overrides.threadId ?? overrides.id ?? 'comment-1',
        transitions: [
            {
                transitionId: 'transition-1',
                toState: overrides.state ?? 'open',
                transitionedAt: 1,
                transitionedBy: { kind: 'plugin', pluginId: 'review-coderabbit' },
                serverRevision: 1,
            },
        ],
        createdAt: 1,
        updatedAt: overrides.updatedAt ?? 1,
        serverRevision: overrides.serverRevision ?? 1,
        ...overrides,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('review comments HTTP action executor', () => {
    beforeEach(() => {
        serverFetchSpy.mockReset();
    });

    it('executes list actions through the authenticated review comments API', async () => {
        const durableComment = comment({ body: 'Loaded through HTTP.' });
        serverFetchSpy.mockResolvedValueOnce(jsonResponse({ items: [durableComment], cursor: null }));
        const { createReviewCommentsHttpActionExecutor } = await import('./api');

        const execute = createReviewCommentsHttpActionExecutor();
        await expect(execute('reviews.comments.list', {
            projectId: 'project-1',
            sessionId: 'session-1',
            states: ['open'],
            folderPath: 'src/security',
            severity: 'critical',
            taxonomyIds: ['security.open_redirect', 'cwe.601'],
            includeHistory: true,
            limit: 10,
        })).resolves.toEqual({ items: [durableComment], cursor: null });

        expect(serverFetchSpy).toHaveBeenCalledTimes(1);
        const [path, init, options] = serverFetchSpy.mock.calls[0] ?? [];
        expect(String(path)).toContain('/v1/reviews/comments?');
        expect(String(path)).toContain('projectId=project-1');
        expect(String(path)).toContain('sessionId=session-1');
        expect(String(path)).toContain('states=open');
        expect(String(path)).toContain('folderPath=src%2Fsecurity');
        expect(String(path)).toContain('severity=critical');
        expect(String(path)).toContain('taxonomyIds=security.open_redirect');
        expect(String(path)).toContain('taxonomyIds=cwe.601');
        expect(String(path)).toContain('includeHistory=true');
        expect(String(path)).toContain('limit=10');
        expect(init).toEqual(expect.objectContaining({ method: 'GET' }));
        expect(options).toEqual(expect.objectContaining({ includeAuth: true }));
    });

    it('seals a plain transition event with request-known binding in the single mutation POST', async () => {
        const durableComment = comment({ state: 'resolved' });
        serverFetchSpy.mockResolvedValueOnce(jsonResponse({ comment: durableComment }));
        const { createReviewCommentsHttpActionExecutor } = await import('./api');

        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({
                accountId: 'account-1',
                mode: 'plain',
            }),
        });
        await expect(execute('reviews.comments.transition', {
            projectId: 'project-1',
            commentId: 'comment-1',
            expectedState: 'open',
            expectedServerRevision: 1,
            toState: 'resolved',
            reason: 'Verified',
            clientMutationId: 'mutation-1',
        })).resolves.toEqual({ comment: durableComment });

        const [path, init] = serverFetchSpy.mock.calls[0] ?? [];
        expect(path).toBe('/v1/reviews/comments/comment-1/transition');
        expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
                projectId: 'project-1',
                expectedState: 'open',
                expectedServerRevision: 1,
                toState: 'resolved',
                reason: 'Verified',
                clientMutationId: 'mutation-1',
                eventEnvelope: {
                    t: 'plain',
                    v: {
                        v: 1,
                        requestBinding: expect.objectContaining({
                            accountId: 'account-1',
                            projectId: 'project-1',
                            actionId: 'reviews.comments.transition',
                            eventKind: 'transitioned',
                            actor: { kind: 'user', userId: 'account-1' },
                            target: { kind: 'comment', commentId: 'comment-1' },
                            expectedCurrentness: {
                                kind: 'transition',
                                expectedState: 'open',
                                expectedServerRevision: 1,
                            },
                        }),
                        details: expect.objectContaining({
                            commentId: 'comment-1',
                            reason: 'Verified',
                        }),
                    },
                },
            });
        expect(serverFetchSpy).toHaveBeenCalledTimes(1);
    });

    it('fails a token-only E2EE mutation before POST', async () => {
        const { createReviewCommentsHttpActionExecutor } = await import('./api');
        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({
                accountId: 'account-1',
                mode: 'e2ee',
            }),
        });

        await expect(execute('reviews.comments.create', {
            projectId: 'project-1',
            anchor: { kind: 'file', filePath: 'src/a.ts' },
            snapshot: { kind: 'too_large', filePath: 'src/a.ts', sizeBytes: 2, capBytes: 1, capturedAt: 1 },
            body: 'body',
            clientMutationId: 'mutation-1',
        })).rejects.toThrow('review_comment_encryption_material_unavailable');
        expect(serverFetchSpy).not.toHaveBeenCalled();
    });

    it('claims one plaintext-Account publication dispatch opaquely and without a comment mutation event', async () => {
        serverFetchSpy.mockImplementationOnce(async (_path: string, init: RequestInit) =>
            jsonResponse(publicationResponseFor(init.body, false)));
        const { createReviewCommentsHttpActionExecutor } = await import('./api');

        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({ accountId: 'account-1', mode: 'plain' }),
            randomBytes: countingRandomBytes(),
        });
        const claim = await execute('reviews.comments.claimPublicationDispatch', publicationPlan);

        expect(serverFetchSpy).toHaveBeenCalledTimes(1);
        const [path, init, options] = serverFetchSpy.mock.calls[0] ?? [];
        expect(path).toBe('/v1/reviews/comments/publication/claim');
        expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
        expect(options).toEqual({ includeAuth: true });
        expect(String((init as RequestInit).body)).not.toContain('PRIVATE-');
        expect(String((init as RequestInit).body)).not.toContain('eventEnvelope');

        const wire = postedTransportRequest(0);
        expect(wire.mode).toBe('plain');
        expect(wire.contentPublicKeyFingerprint).toBeNull();
        expect(wire.entries).toEqual([{
            happierCommentId: 'comment-1',
            expectedServerRevision: 1,
            publicationCorrelationId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        }]);
        expect(claim).toEqual({
            disposition: 'dispatch',
            dispatchToken: 'dispatch-token-1',
            publicationPlanId: wire.publicationPlanId,
            entries: [{ happierCommentId: 'comment-1', publicationCorrelationId: wire.entries[0]!.publicationCorrelationId }],
            verdict: { publicationCorrelationId: wire.verdict!.publicationCorrelationId },
            instructions: { entries: ['dispatch'], verdict: 'dispatch' },
            priorResult: null,
        });
    });

    it('settles an E2EE publication without putting provider references or failure text on the wire', async () => {
        serverFetchSpy
            .mockImplementationOnce(async (_path: string, init: RequestInit) =>
                jsonResponse(publicationResponseFor(init.body, false)))
            .mockImplementationOnce(async (_path: string, init: RequestInit) =>
                jsonResponse(publicationResponseFor(init.body, true)));
        const { createReviewCommentsHttpActionExecutor } = await import('./api');

        const plan: ReviewCommentPublicationPlanV1 = {
            ...publicationPlan,
            entries: [
                publicationPlan.entries[0]!,
                { ...publicationPlan.entries[0]!, happierCommentId: 'comment-2', expectedServerRevision: 2 },
            ],
        };
        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({ accountId: 'account-1', mode: 'e2ee', material: e2eeMaterial }),
            randomBytes: countingRandomBytes(),
        });

        const claim = await execute(
            'reviews.comments.claimPublicationDispatch',
            plan,
        ) as ReviewCommentClaimPublicationDispatchResponseV1;
        const result = {
            publicationPlanId: claim.publicationPlanId,
            entries: [
                {
                    happierCommentId: 'comment-1',
                    publicationCorrelationId: claim.entries[0]!.publicationCorrelationId,
                    outcome: { kind: 'published' as const, externalRef: 'PRIVATE-native-comment-ref' },
                },
                {
                    happierCommentId: 'comment-2',
                    publicationCorrelationId: claim.entries[1]!.publicationCorrelationId,
                    outcome: {
                        kind: 'failed' as const,
                        code: 'PRIVATE-provider-code',
                        message: 'PRIVATE-provider-message',
                    },
                },
            ],
            verdict: {
                publicationCorrelationId: claim.verdict!.publicationCorrelationId,
                outcome: { kind: 'published' as const, externalRef: 'PRIVATE-native-verdict-ref' },
            },
        };

        const settled = await execute(
            'reviews.comments.claimPublicationDispatch',
            createReviewCommentPublicationSettlementRequestV1(plan, claim, result),
        ) as ReviewCommentClaimPublicationDispatchResponseV1;

        expect(serverFetchSpy).toHaveBeenCalledTimes(2);
        const settlementBody = String((serverFetchSpy.mock.calls[1]?.[1] as RequestInit).body);
        expect(settlementBody).not.toContain('PRIVATE-');
        const wire = postedTransportRequest(1);
        expect(wire.mode).toBe('e2ee');
        expect(wire.contentPublicKeyFingerprint).toEqual(expect.any(String));
        const outcomes = [
            ...wire.settlement!.result.entries.map((entry) => entry.outcome),
            ...('kind' in wire.settlement!.result.verdict ? [] : [wire.settlement!.result.verdict.outcome]),
        ];
        expect(outcomes.map((outcome) => outcome.content?.t)).toEqual(['encrypted', 'encrypted', 'encrypted']);
        expect(settled.priorResult).toEqual(result);
    });

    it('fails a token-only E2EE publication claim before POST', async () => {
        const { createReviewCommentsHttpActionExecutor } = await import('./api');
        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({ accountId: 'account-1', mode: 'e2ee' }),
        });

        await expect(execute('reviews.comments.claimPublicationDispatch', publicationPlan))
            .rejects.toThrow('review_comment_encryption_material_unavailable');
        expect(serverFetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a publication response whose plan binding the server substituted', async () => {
        serverFetchSpy.mockResolvedValueOnce(jsonResponse({
            disposition: 'dispatch',
            dispatchToken: 'dispatch-token-1',
            publicationPlanId: 'P'.repeat(43),
            entries: [{ happierCommentId: 'comment-1', publicationCorrelationId: 'A'.repeat(43) }],
            verdict: { publicationCorrelationId: 'V'.repeat(43) },
            instructions: { entries: ['dispatch'], verdict: 'dispatch' },
            priorResult: null,
        }));
        const { createReviewCommentsHttpActionExecutor } = await import('./api');
        const execute = createReviewCommentsHttpActionExecutor({
            resolveEventStorageContext: async () => ({ accountId: 'account-1', mode: 'plain' }),
        });

        await expect(execute('reviews.comments.claimPublicationDispatch', publicationPlan))
            .rejects.toThrow('review_comment_publication_binding_mismatch');
        expect(serverFetchSpy).toHaveBeenCalledTimes(1);
    });
});
