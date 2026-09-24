import { createStorageModuleStub, createToolCallMessageFixture, renderHook } from '@/dev/testkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const message = createToolCallMessageFixture({
    id: 'tool-call-1',
    createdAt: 10,
    tool: {
        name: 'Diff',
        state: 'completed',
        input: {
            files: [
                {
                    file_path: 'src/app.ts',
                    oldText: 'a\n',
                    newText: 'b\n',
                    unified_diff: 'diff --git a/src/app.ts b/src/app.ts\n',
                },
            ],
            _happier: {
                v: 2,
                protocol: 'codex',
                provider: 'codex',
                rawToolName: 'CodexDiff',
                canonicalToolName: 'Diff',
                sessionChangeScope: 'turn',
                turnId: 'turn_1',
                sessionId: 'session_1',
                source: 'provider_native',
                confidence: 'exact',
                turnStatus: 'completed',
                seqRange: {
                    startSeqInclusive: 1,
                    endSeqInclusive: 4,
                },
            },
        },
        createdAt: 10,
        startedAt: 10,
        completedAt: 11,
        description: null,
        result: { status: 'completed' },
    },
});

function createTurnEvidenceMessage(params: Readonly<{
    id: string;
    createdAt: number;
    source: string;
    confidence: string;
    unifiedDiff: string;
}>) {
    return createToolCallMessageFixture({
        id: params.id,
        createdAt: params.createdAt,
        tool: {
            name: 'Diff',
            state: 'completed',
            input: {
                files: [
                    {
                        file_path: 'src/app.ts',
                        change_kind: 'modified',
                        source: params.source,
                        confidence: params.confidence,
                        provider: 'codex',
                        unified_diff: params.unifiedDiff,
                    },
                ],
                _happier: {
                    v: 2,
                    protocol: 'codex',
                    provider: 'codex',
                    rawToolName: 'CodexDiff',
                    canonicalToolName: 'Diff',
                    sessionChangeScope: 'turn',
                    turnId: 'turn_1',
                    sessionId: 'session_1',
                    source: params.source,
                    confidence: params.confidence,
                    turnStatus: 'completed',
                    seqRange: {
                        startSeqInclusive: 1,
                        endSeqInclusive: 4,
                    },
                },
            },
            createdAt: params.createdAt,
            startedAt: params.createdAt,
            completedAt: params.createdAt + 1,
            description: null,
            result: { status: 'completed' },
        },
    });
}

const canonicalPatchEvidence = createTurnEvidenceMessage({
    id: 'tool-call-canonical',
    createdAt: 10,
    source: 'canonical_patch_tool',
    confidence: 'exact',
    unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts\n@@ canonical @@\n',
});

const laterProviderEvidence = createTurnEvidenceMessage({
    id: 'tool-call-provider',
    createdAt: 20,
    source: 'provider_native',
    confidence: 'best_effort',
    unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts\n@@ provider @@\n',
});

let transcriptMessages: unknown[] = [message];

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSession: () => ({ serverId: 'home-b', metadata: {} }),
        useSessionMessages: () => ({
            messages: transcriptMessages,
        }),
    });
});

describe('useDerivedSessionChangeSet', () => {
    beforeEach(() => {
        transcriptMessages = [message];
    });

    it('presents the canonical patch for a path whatever order the turn evidence arrived in', async () => {
        for (const ordered of [
            [canonicalPatchEvidence, laterProviderEvidence],
            [laterProviderEvidence, canonicalPatchEvidence],
        ]) {
            transcriptMessages = ordered;
            vi.resetModules();
            const { useDerivedSessionChangeSet } = await import('./useDerivedSessionChangeSet');
            const { getCurrent } = await renderHook(() => useDerivedSessionChangeSet({
                serverId: 'home-b',
                sessionId: 'session_1',
            }));

            expect(getCurrent().latestTurnAgentReportedDiffByPath?.get('src/app.ts')).toContain('@@ canonical @@');
        }
    });

    it('presents the canonically latest turn even when its evidence was published first', async () => {
        const laterTurnPublishedFirst = createToolCallMessageFixture({
            id: 'tool-call-turn-2',
            createdAt: 5,
            tool: {
                name: 'Diff', state: 'completed',
                input: {
                    files: [{ file_path: 'src/late.ts', change_kind: 'modified', source: 'provider_native', confidence: 'exact', provider: 'codex', unified_diff: 'late diff' }],
                    _happier: {
                        v: 2, protocol: 'codex', provider: 'codex', rawToolName: 'CodexDiff', canonicalToolName: 'Diff',
                        sessionChangeScope: 'turn', turnId: 'turn_2', sessionId: 'session_1',
                        source: 'provider_native', confidence: 'exact', turnStatus: 'completed',
                        seqRange: { startSeqInclusive: 9, endSeqInclusive: 12 },
                    },
                },
                createdAt: 5, startedAt: 5, completedAt: 6, description: null, result: { status: 'completed' },
            },
        });
        transcriptMessages = [laterTurnPublishedFirst, message];
        vi.resetModules();
        const { useDerivedSessionChangeSet } = await import('./useDerivedSessionChangeSet');
        const { getCurrent } = await renderHook(() => useDerivedSessionChangeSet({
            serverId: 'home-b',
            sessionId: 'session_1',
        }));

        expect(getCurrent().latestTurnChangeSet?.turnId).toBe('turn_2');
    });

    it('derives a session change set and provider diffs from canonical Diff messages', async () => {
        vi.resetModules();
        const { useDerivedSessionChangeSet } = await import('./useDerivedSessionChangeSet');
        const { getCurrent } = await renderHook(() => useDerivedSessionChangeSet({
            serverId: 'home-b',
            sessionId: 'session_1',
        }));
        const current = getCurrent();

        expect(current.sessionChangeSet).toEqual(expect.objectContaining({
            sessionId: 'session_1',
            turns: [expect.objectContaining({ turnId: 'turn_1' })],
        }));
        expect(current.latestTurnChangeSet?.turnId).toBe('turn_1');
        const providerDiffMap = current.providerDiffByPath;
        expect(providerDiffMap).toBeInstanceOf(Map);
        if (!providerDiffMap) {
            throw new Error('Expected provider diff map');
        }
        expect(providerDiffMap.get('src/app.ts')).toContain('diff --git a/src/app.ts b/src/app.ts');
    });

    it('fails closed when the retained bare-id transcript belongs to another Home', async () => {
        vi.resetModules();
        const { useDerivedSessionChangeSet } = await import('./useDerivedSessionChangeSet');
        const { getCurrent } = await renderHook(() => useDerivedSessionChangeSet({
            serverId: 'home-a',
            sessionId: 'session_1',
        }));

        expect(getCurrent()).toMatchObject({
            turnChangeSets: [],
            latestTurnChangeSet: null,
            latestTurnScopedChangeSet: null,
            sessionChangeSet: null,
            latestTurnDiffByPath: null,
            latestTurnAgentReportedDiffByPath: null,
            latestTurnCheckpointDiffByPath: null,
            providerDiffByPath: null,
        });
    });
});
