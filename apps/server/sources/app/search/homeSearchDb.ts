import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
    openHomeSearchSqliteBinding,
    type HomeSearchSqliteDatabase,
    type HomeSearchSqliteValue,
} from './homeSearchSqliteBinding';

export const HOME_SEARCH_SCHEMA_VERSION = 1;

export type HomeSearchMessage = Readonly<{
    id: string;
    sessionId: string;
    seq: number;
    createdAtMs: number;
    updatedAtMs?: number;
    role?: string | null;
    text: string;
}>;

export type HomeSearchHit = Readonly<{
    id: string;
    sessionId: string;
    seqFrom: number;
    seqTo: number;
    createdAtFromMs: number;
    createdAtToMs: number;
    role: string | null;
    text: string;
    snippet: string;
    score: number;
}>;

export type HomeSearchDb = Readonly<{
    path: string;
    upsert(message: HomeSearchMessage): void;
    remove(messageId: string): void;
    removeSession(sessionId: string): void;
    clear(): void;
    count(): number;
    search(input: Readonly<{ query: string; sessionId?: string; sessionIds?: readonly string[]; maxResults?: number }>): HomeSearchHit[];
    close(): void;
}>;

function sanitizeStoredText(value: string): string {
    return String(value ?? '').replace(/\u0000/gu, '').trim();
}

function normalizeFtsText(value: string): string {
    return sanitizeStoredText(value).normalize('NFKC');
}

// Unicode61 has no word segmentation for scripts written without inter-word spaces, so a
// Chinese, Japanese, or Korean run becomes one giant token that no sub-word query can match.
// Overlapping unigrams and bigrams restore sub-run searchability;
// they are applied only to the derived FTS text, never to the stored message text.
const CJK_RUN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

function segmentCjkRuns(value: string): string {
    return value.replace(CJK_RUN_PATTERN, (run) => {
        const chars = Array.from(run);
        const terms = [...chars];
        for (let i = 0; i + 1 < chars.length; i += 1) terms.push(chars[i]! + chars[i + 1]!);
        return ` ${terms.join(' ')} `;
    });
}

function buildFtsQuery(value: string): Readonly<{ match: string; snippetTerms: string[] }> {
    const matchParts: string[] = [];
    const snippetTerms: string[] = [];
    for (const rawTerm of normalizeFtsText(value).replace(/"/gu, ' ').split(/\s+/u)) {
        const prefix = rawTerm.endsWith('*');
        const displayTerm = rawTerm.replace(/\*+$/u, '');
        if (!displayTerm) continue;
        snippetTerms.push(displayTerm);
        for (const token of segmentCjkRuns(displayTerm).split(/\s+/u).filter(Boolean)) {
            matchParts.push(`"${token.replace(/"/gu, '""')}"${prefix ? '*' : ''}`);
        }
    }
    return { match: matchParts.join(' AND '), snippetTerms };
}

const SNIPPET_WINDOW_CHARS = 160;

function moveByCodePoints(text: string, from: number, count: number): number {
    let index = from;
    if (count < 0) {
        for (let remaining = -count; remaining > 0 && index > 0; remaining -= 1) {
            index -= 1;
            const unit = text.charCodeAt(index);
            if (index > 0 && unit >= 0xDC00 && unit <= 0xDFFF) index -= 1;
        }
        return index;
    }
    for (let remaining = count; remaining > 0 && index < text.length; remaining -= 1) {
        const codePoint = text.codePointAt(index);
        index += codePoint !== undefined && codePoint > 0xFFFF ? 2 : 1;
    }
    return index;
}

/** Renders the user-visible snippet from the pristine message text so segmented index text never leaks into results. */
function buildSnippet(text: string, terms: readonly string[]): string {
    const haystack = text.toLowerCase();
    let matchStart = -1;
    let matchLength = 0;
    let matchedTerm = '';
    for (const term of terms) {
        const found = haystack.indexOf(term.toLowerCase());
        if (found >= 0 && (matchStart < 0 || found < matchStart)) {
            matchStart = found;
            matchLength = term.length;
            matchedTerm = term;
        }
    }
    if (matchStart < 0) {
        const end = moveByCodePoints(text, 0, SNIPPET_WINDOW_CHARS);
        return end < text.length ? `${text.slice(0, end)}…` : text;
    }
    // Extend ASCII prefix matches (gam* -> gamma) to the end of the token they started.
    if (/[A-Za-z0-9_*-]$/u.test(matchedTerm)) {
        while (matchStart + matchLength < text.length && /[A-Za-z0-9_$-]/u.test(text[matchStart + matchLength]!)) matchLength += 1;
    }
    const matchEnd = matchStart + matchLength;
    const start = moveByCodePoints(text, matchStart, -60);
    const end = moveByCodePoints(text, matchEnd, 100);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function boundedLimit(value: number | undefined): number {
    if (!Number.isFinite(value)) return 20;
    return Math.max(1, Math.min(100, Math.trunc(value as number)));
}

export function resolveHomeSearchDbPath(dataDir: string): string {
    return resolve(join(dataDir, 'derived', 'search.sqlite'));
}

export async function openHomeSearchDb(params: Readonly<{ dbPath?: string; dataDir?: string }>): Promise<HomeSearchDb> {
    if (!params.dbPath && !params.dataDir) throw new Error('Personal Home search database path is required');
    const path = resolve(params.dbPath ?? resolveHomeSearchDbPath(params.dataDir!));
    await mkdir(dirname(path), { recursive: true });
    let db: HomeSearchSqliteDatabase;
    try {
        db = await openHomeSearchSqliteBinding(path);
    } catch (error) {
        throw new Error(`Personal Home search index is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        db.exec('PRAGMA journal_mode = WAL;');
        db.exec('PRAGMA foreign_keys = ON;');
        db.exec(`
            CREATE TABLE IF NOT EXISTS home_search_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS home_search_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER,
                role TEXT,
                text TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS home_search_messages_session_seq
                ON home_search_messages(session_id, seq);
            CREATE VIRTUAL TABLE IF NOT EXISTS home_search_fts USING fts5(
                id UNINDEXED,
                session_id UNINDEXED,
                seq UNINDEXED,
                created_at_ms UNINDEXED,
                role UNINDEXED,
                text,
                tokenize = 'unicode61 remove_diacritics 0 tokenchars ''_-$'''
            );
        `);
        const existingVersion = db.prepare('SELECT value FROM home_search_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
        if (existingVersion?.value !== undefined && existingVersion.value !== String(HOME_SEARCH_SCHEMA_VERSION)) {
            throw new Error(`Unsupported Personal Home search schema version: ${existingVersion.value}`);
        }
        db.prepare('INSERT OR IGNORE INTO home_search_meta(key, value) VALUES (?, ?)').run(
            'schema_version',
            String(HOME_SEARCH_SCHEMA_VERSION),
        );
    } catch (error) {
        db.close();
        throw new Error(`Personal Home search index is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const upsert = db.prepare(`
        INSERT INTO home_search_messages(id, session_id, seq, created_at_ms, updated_at_ms, role, text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            session_id = excluded.session_id,
            seq = excluded.seq,
            created_at_ms = excluded.created_at_ms,
            updated_at_ms = excluded.updated_at_ms,
            role = excluded.role,
            text = excluded.text
    `);
    const deleteMessage = db.prepare('DELETE FROM home_search_messages WHERE id = ?');
    const deleteFts = db.prepare('DELETE FROM home_search_fts WHERE id = ?');
    const insertFts = db.prepare(`
        INSERT INTO home_search_fts(id, session_id, seq, created_at_ms, role, text)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const deleteSessionMessages = db.prepare('DELETE FROM home_search_messages WHERE session_id = ?');
    const deleteSessionFts = db.prepare('DELETE FROM home_search_fts WHERE session_id = ?');
    const countMessages = db.prepare('SELECT count(*) AS count FROM home_search_messages');

    const result: HomeSearchDb = {
        path,
        upsert(message) {
            const text = sanitizeStoredText(message.text);
            if (!message.id || !message.sessionId || !text) return;
            db.exec('BEGIN IMMEDIATE');
            try {
                upsert.run(
                    message.id,
                    message.sessionId,
                    message.seq,
                    message.createdAtMs,
                    message.updatedAtMs ?? null,
                    message.role ?? null,
                    text,
                );
                deleteFts.run(message.id);
                insertFts.run(
                    message.id,
                    message.sessionId,
                    message.seq,
                    message.createdAtMs,
                    message.role ?? null,
                    segmentCjkRuns(normalizeFtsText(text)),
                );
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
        remove(messageId) {
            db.exec('BEGIN IMMEDIATE');
            try {
                deleteMessage.run(messageId);
                deleteFts.run(messageId);
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
        removeSession(sessionId) {
            db.exec('BEGIN IMMEDIATE');
            try {
                deleteSessionMessages.run(sessionId);
                deleteSessionFts.run(sessionId);
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
        clear() {
            db.exec('BEGIN IMMEDIATE');
            try {
                db.exec('DELETE FROM home_search_messages; DELETE FROM home_search_fts;');
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
        count() {
            const row = countMessages.get() as { count?: number } | undefined;
            return Number(row?.count ?? 0);
        },
        search(input) {
            const parsedQuery = buildFtsQuery(input.query);
            if (!parsedQuery.match) return [];
            const whereParts: string[] = [];
            const args: HomeSearchSqliteValue[] = [parsedQuery.match];
            if (input.sessionId) {
                whereParts.push('f.session_id = ?');
                args.push(input.sessionId);
            } else if (input.sessionIds) {
                if (input.sessionIds.length === 0) return [];
                whereParts.push(`f.session_id IN (${input.sessionIds.map(() => '?').join(',')})`);
                args.push(...input.sessionIds);
            }
            const where = whereParts.length > 0 ? ` AND ${whereParts.join(' AND ')}` : '';
            args.push(boundedLimit(input.maxResults));
            const rows = db.prepare(`
                SELECT f.id, f.session_id AS sessionId, f.seq, f.created_at_ms AS createdAtMs,
                    f.role, m.text, bm25(home_search_fts) AS rank
                FROM home_search_fts f
                JOIN home_search_messages m ON m.id = f.id
                WHERE home_search_fts MATCH ?${where}
                ORDER BY rank ASC, f.created_at_ms DESC, f.seq DESC
                LIMIT ?
            `).all(...args) as Array<Record<string, unknown>>;
            return rows.map((row) => {
                const rank = Number(row.rank);
                const score = Number.isFinite(rank) ? 1 / (1 + Math.exp(rank)) : 0;
                const seq = Number(row.seq);
                const createdAtMs = Number(row.createdAtMs);
                const text = String(row.text);
                return {
                    id: String(row.id),
                    sessionId: String(row.sessionId),
                    seqFrom: seq,
                    seqTo: seq,
                    createdAtFromMs: createdAtMs,
                    createdAtToMs: createdAtMs,
                    role: typeof row.role === 'string' ? row.role : null,
                    text,
                    snippet: buildSnippet(text, parsedQuery.snippetTerms),
                    score,
                } satisfies HomeSearchHit;
            });
        },
        close() {
            db.close();
        },
    };
    return result;
}
