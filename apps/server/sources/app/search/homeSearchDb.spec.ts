import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
                `db.upsert({ id: 'bun-proof', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'packaged bun fts proof' });`,
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

    it('indexes Unicode and code identifiers, returns snippets, and persists watermarks', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-search-'));
        const db = await openHomeSearchDb({ dbPath: join(root, 'derived', 'search.sqlite') });
        db.upsert({
            id: 'm-1', sessionId: 's-1', seq: 3, createdAtMs: 1_000, role: 'agent',
            text: 'Réponse — 東京 API_KEY_42',
        });
        db.setWatermark('s-1', 3);
        expect(db.getWatermark('s-1')).toBe(3);
        expect(db.search({ query: '東京' })).toEqual([
            expect.objectContaining({ sessionId: 's-1', seqFrom: 3, snippet: expect.stringContaining('東京') }),
        ]);
        expect(db.search({ query: 'API_KEY_42' })).toHaveLength(1);
        expect(db.search({ query: 'API_KEY_*' })).toHaveLength(1);
        db.close();
        expect((await readFile(join(root, 'derived', 'search.sqlite'))).byteLength).toBeGreaterThan(0);
        const reopened = await openHomeSearchDb({ dbPath: join(root, 'derived', 'search.sqlite') });
        expect(reopened.getWatermark('s-1')).toBe(3);
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
});
