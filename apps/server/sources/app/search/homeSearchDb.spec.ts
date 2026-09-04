import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { openHomeSearchDb } from './homeSearchDb';

const bunAvailable = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

describe('Home search FTS5 owner', () => {
    it.skipIf(!bunAvailable)('opens and searches FTS5 from the packaged Bun server runtime', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-bun-'));
        try {
            const entrypoint = join(root, 'entrypoint.ts');
            const executablePath = join(root, process.platform === 'win32' ? 'home-search-probe.exe' : 'home-search-probe');
            const homeSearchDbPath = fileURLToPath(new URL('./homeSearchDb.ts', import.meta.url));
            const builder = join(
                dirname(fileURLToPath(import.meta.url)),
                '../../../../../packages/cli-common/scripts/buildServerBunBinary.mjs',
            );
            await writeFile(entrypoint, [
                `import { openHomeSearchDb } from ${JSON.stringify(homeSearchDbPath)};`,
                `const db = await openHomeSearchDb({ dbPath: ${JSON.stringify(join(root, 'search.sqlite'))} });`,
                `db.upsertMany([`,
                `  { id: 'bun-proof', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'packaged bun fts proof' },`,
                `  { id: 'bun-neighbor', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'neighboring runtime row' },`,
                `]);`,
                `const hits = db.search({ query: 'packaged' });`,
                `db.close();`,
                `if (hits.length !== 1 || hits[0]?.id !== 'bun-proof') throw new Error('Packaged Bun FTS5 search failed');`,
                `process.stdout.write('home-search-bun-ok');`,
            ].join('\n'), 'utf8');

            const compiled = spawnSync('bun', [
                builder,
                `--target=bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`,
                `--entrypoint=${entrypoint}`,
                `--outfile=${executablePath}`,
            ], { encoding: 'utf8' });
            expect(compiled.status, compiled.stderr).toBe(0);

            const runtime = spawnSync(executablePath, [], { encoding: 'utf8' });
            expect(runtime.status, runtime.stderr).toBe(0);
            expect(runtime.stdout).toBe('home-search-bun-ok');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }, 60_000);

    it('indexes Unicode and code identifiers and returns snippets across reopen', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'derived', 'search.sqlite') });
        db.upsert({
            id: 'm-1', sessionId: 's-1', seq: 3, createdAtMs: 1_000, role: 'agent',
            text: 'Réponse — 東京 API_KEY_42',
        });
        expect(db.search({ query: '東京' })).toEqual([
            expect.objectContaining({ sessionId: 's-1', seqFrom: 3, snippet: expect.stringContaining('東京') }),
        ]);
        expect(db.search({ query: 'API_KEY_42' })).toHaveLength(1);
        expect(db.search({ query: 'API_KEY_*' })).toHaveLength(1);
        db.close();
        expect((await readFile(join(root, 'derived', 'search.sqlite'))).byteLength).toBeGreaterThan(0);
        const reopened = await openHomeSearchDb({ dbPath: join(root, 'derived', 'search.sqlite') });
        expect(reopened.search({ query: '東京' })).toHaveLength(1);
        reopened.close();
    });

    it('replaces edits and removes deleted messages without touching canonical data', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-edit-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'old unique token' });
        db.upsert({ id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'new unique token' });
        expect(db.search({ query: 'old' })).toEqual([]);
        expect(db.search({ query: 'new' })).toHaveLength(1);
        db.remove('m-1');
        expect(db.search({ query: 'new' })).toEqual([]);

        db.upsertMany([
            { id: 'm-bulk-edit', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'obsolete bulk wording' },
            { id: 'm-bulk-edit', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'current bulk wording' },
        ]);
        expect(db.count()).toBe(1);
        expect(db.search({ query: 'obsolete' })).toEqual([]);
        expect(db.search({ query: 'current' }).map((hit) => hit.id)).toEqual(['m-bulk-edit']);
        db.close();
    });

    it('rolls back every message in a bulk-upsert page when one write fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-bulk-rollback-'));
        const dbPath = join(root, 'search.sqlite');
        const db = await openHomeSearchDb({ dbPath });
        const failureInjector = new DatabaseSync(dbPath);
        failureInjector.exec(`
            CREATE TRIGGER fail_second_bulk_message
            BEFORE INSERT ON home_search_messages
            WHEN NEW.id = 'm-poisoned'
            BEGIN
                SELECT RAISE(ABORT, 'injected bulk-upsert failure');
            END;
        `);
        failureInjector.close();

        expect(() => db.upsertMany([
            { id: 'm-first', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'must roll back' },
            { id: 'm-poisoned', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'trigger failure' },
        ])).toThrow('injected bulk-upsert failure');
        expect(db.count()).toBe(0);
        expect(db.search({ query: 'must' })).toEqual([]);
        db.close();
    });

    it('projects large pages through bounded multi-row statements instead of per-message native calls', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-bulk-statements-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        const messages = Array.from({ length: 1_000 }, (_, index) => ({
            id: `m-${index}`,
            sessionId: `s-${index % 10}`,
            seq: index + 1,
            createdAtMs: index + 1,
            text: `bounded statement projection ${index}`,
        }));
        const run = vi.spyOn(StatementSync.prototype, 'run');

        db.upsertMany(messages);
        const nativeStatementRuns = run.mock.calls.length;
        run.mockRestore();

        expect(db.count()).toBe(messages.length);
        expect(db.search({ query: 'projection 999' }).map((hit) => hit.id)).toEqual(['m-999']);
        // Bulk projection must cross the native boundary fewer than once per row;
        // the owner derives its exact chunk size from SQLite's bind-variable ceiling.
        expect(nativeStatementRuns).toBeLessThan(messages.length);
        db.close();
    });

    it('searches inside unspaced CJK runs and keeps hit text and snippets pristine', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-cjk-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({
            id: 'm-ja', sessionId: 's-1', seq: 1, createdAtMs: 1, role: 'user',
            text: '今日は東京のテストを行いました',
        });
        db.upsert({
            id: 'm-zh', sessionId: 's-2', seq: 1, createdAtMs: 2, role: 'user',
            text: '我有一个梦想',
        });
        db.upsert({
            id: 'm-ko', sessionId: 's-3', seq: 1, createdAtMs: 3, role: 'user',
            text: '안녕하세요세계',
        });

        // Japanese and Chinese run without inter-word spaces; sub-word queries must still match.
        expect(db.search({ query: '東京' }).map((hit) => hit.id)).toEqual(['m-ja']);
        expect(db.search({ query: '京' }).map((hit) => hit.id)).toEqual(['m-ja']);
        expect(db.search({ query: '東京のテスト' }).map((hit) => hit.id)).toEqual(['m-ja']);
        expect(db.search({ query: '我有' }).map((hit) => hit.id)).toEqual(['m-zh']);
        expect(db.search({ query: '세계' }).map((hit) => hit.id)).toEqual(['m-ko']);
        // A bigram present in neither document must not match.
        expect(db.search({ query: '世界杯' })).toEqual([]);

        // User-visible text and snippets come from the pristine message text, not the segmented index.
        const hit = db.search({ query: '東京' })[0]!;
        expect(hit.text).toBe('今日は東京のテストを行いました');
        expect(hit.snippet).toContain('東京');
        expect(hit.snippet).not.toContain('<mark>');
        db.close();
    });

    it('requires every query term, honors prefix stars, and returns match-centered snippets', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-terms-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'doc', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'alpha beta gamma delta' });
        db.upsert({ id: 'partial', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'alpha solo' });

        // Multi-term queries are AND semantics: a document missing one term never matches.
        expect(db.search({ query: 'alpha beta' }).map((hit) => hit.id)).toEqual(['doc']);
        // Quoted phrases are their terms ANDed order-insensitively, matching the neutral
        // memory-search query contract (no phrase-ordering operator exists in that shape).
        expect(db.search({ query: '"beta alpha"' }).map((hit) => hit.id)).toEqual(['doc']);
        expect(db.search({ query: '"alpha solo"' }).map((hit) => hit.id)).toEqual(['partial']);
        // Prefix stars extend a term to any token that starts with it.
        expect(db.search({ query: 'gam*' }).map((hit) => hit.id)).toEqual(['doc']);
        expect(db.search({ query: 'solo' })[0]!.snippet).toContain('solo');
        expect(db.search({ query: 'solo' })[0]!.snippet).not.toContain('<mark>');
        db.close();
    });

    it('indexes standalone and skin-tone emoji as searchable tokens without false positives', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-emoji-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'm-e', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'ship it 🦘 nice 👍🏽' });

        expect(db.search({ query: '🦘' }).map((hit) => hit.id)).toEqual(['m-e']);
        expect(db.search({ query: '👍🏽' }).map((hit) => hit.id)).toEqual(['m-e']);
        expect(db.search({ query: '🚀' })).toEqual([]);
        db.close();
    });

    it('keeps match-centered snippet boundaries Unicode-safe', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-snippet-unicode-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({
            id: 'm-window', sessionId: 's-1', seq: 1, createdAtMs: 1,
            text: `aa👍🏽${'b'.repeat(56)} needle ${'c'.repeat(150)}`,
        });

        const snippet = db.search({ query: 'needle' })[0]!.snippet;
        expect(snippet).toContain('needle');
        expect(snippet).not.toMatch(/[\uD800-\uDFFF]/u);
        db.close();
    });

    it('centers snippets on canonically equivalent Unicode matches while preserving pristine text', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-snippet-normalized-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        const pristineMatch = 'Cafe\u0301';
        const pristineText = `${'before '.repeat(40)}${pristineMatch} ${'after '.repeat(39)}after`;
        db.upsert({
            id: 'm-normalized', sessionId: 's-1', seq: 1, createdAtMs: 1,
            text: pristineText,
        });

        const hit = db.search({ query: 'CAFÉ' })[0]!;
        expect(hit.text).toBe(pristineText);
        expect(hit.snippet).toContain(pristineMatch);
        expect(hit.snippet).not.toContain('CAFÉ');
        db.close();
    });

    it('maps lower FTS ranks to distinct higher bounded relevance scores', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-rank-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'strong', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'needle needle needle' });
        db.upsert({ id: 'weak', sessionId: 's-1', seq: 2, createdAtMs: 2, text: 'needle haystack haystack haystack' });

        const hits = db.search({ query: 'needle' });
        expect(hits.map((hit) => hit.id)).toEqual(['strong', 'weak']);
        expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
        expect(hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
        db.close();
    });

    it('searches visibility sets larger than a portable SQLite bind-variable batch', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-visible-sessions-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'weak', sessionId: 's-0', seq: 1, createdAtMs: 1, text: 'visibility amid unrelated filler words' });
        db.upsert({ id: 'strong', sessionId: 's-32999', seq: 1, createdAtMs: 2, text: 'visibility visibility visibility' });

        const visibleSessions = Array.from({ length: 33_000 }, (_, index) => ({
            sessionId: `s-${index}`,
            maximumSeq: null,
        }));
        expect(db.search({ query: 'visibility', sessionConstraints: visibleSessions, maxResults: 1 }))
            .toEqual([expect.objectContaining({ id: 'strong', sessionId: 's-32999' })]);
        db.close();
    });

    it('applies each Session publication ceiling before the result limit', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-publication-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        db.upsert({ id: 'published', sessionId: 'shared', seq: 4, createdAtMs: 1, text: 'needle among ordinary words' });
        db.upsert({ id: 'private', sessionId: 'shared', seq: 5, createdAtMs: 2, text: 'needle needle needle' });
        db.upsert({ id: 'hosted', sessionId: 'owned', seq: 99, createdAtMs: 3, text: 'needle hosted' });

        expect(db.search({
            query: 'needle',
            sessionConstraints: [
                { sessionId: 'shared', maximumSeq: 4 },
                { sessionId: 'owned', maximumSeq: null },
            ],
            maxResults: 2,
        }).map((hit) => hit.id)).toEqual(['hosted', 'published']);
        db.close();
    });
});
