import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExternalSessionCandidateIndexCursorResetError, executeExternalSessionCandidateQuery } from './candidateQuery';

type Row = { remoteSessionId: string; updatedAtMs: number };

const roots: string[] = [];

function sourceFor(corpus: Row[]) {
    return async ({ cursor, limit }: Readonly<{ cursor?: string; limit: number }>) => {
        const offset = cursor ? Number.parseInt(cursor.slice('scan:'.length), 10) : 0;
        const candidates = corpus.slice(offset, offset + limit).map((row) => ({ ...row }));
        const nextOffset = offset + candidates.length;
        return {
            candidates,
            nextCursor: nextOffset < corpus.length ? `scan:${nextOffset}` : null,
            preparation: {
                kind: 'building_candidate_index' as const,
                scanned: nextOffset,
                total: corpus.length,
            },
        };
    };
}

function query(activeServerDir: string, listCandidates: ReturnType<typeof sourceFor>, cursor?: string) {
    return executeExternalSessionCandidateQuery({
        activeServerDir,
        agentIdentity: { pluginId: 'fixture', localId: 'fixture' },
        agentSourceCustody: { kind: 'development', registeredRootId: 'incremental-head-test' },
        source: { kind: 'fixture' },
        ...(cursor === undefined ? {} : { cursor }),
        limit: 10,
        listCandidates,
    });
}

async function publish(
    activeServerDir: string,
    listCandidates: ReturnType<typeof sourceFor>,
): Promise<Awaited<ReturnType<typeof query>>> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const page = await query(activeServerDir, listCandidates);
        if (!page.preparation) return page;
    }
    throw new Error('candidate index did not publish');
}

describe('External Sessions incremental candidate-index head refresh', () => {
    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    it('publishes a new generation from rows ahead of the first identity+content watermark', async () => {
        const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-candidate-head-refresh-'));
        roots.push(activeServerDir);
        const corpus = Array.from({ length: 120 }, (_, index) => ({
            remoteSessionId: `row-${index}`,
            updatedAtMs: 1_000 - index,
        }));
        const listCandidates = sourceFor(corpus);
        const before = await publish(activeServerDir, listCandidates);
        const staleCursor = before.nextCursor;
        corpus[0] = { remoteSessionId: 'row-0', updatedAtMs: 10_000 };
        corpus.unshift({ remoteSessionId: 'arrival', updatedAtMs: 11_000 });

        const refreshed = await query(activeServerDir, listCandidates);

        expect(refreshed.preparation).toBeUndefined();
        expect(refreshed.candidates.slice(0, 2).map((row) => row.remoteSessionId)).toEqual([
            'arrival',
            'row-0',
        ]);
        await expect(query(activeServerDir, listCandidates, staleCursor!))
            .rejects.toBeInstanceOf(ExternalSessionCandidateIndexCursorResetError);
    });
});
