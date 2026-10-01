import type {
    FileBackedTranscriptPageResult,
    FileBackedTranscriptReadAfterResult,
    FileBackedTranscriptSessionStore,
    FileBackedTranscriptSubscriptionListener,
} from './fileBackedTranscripts/store';
import { SessionMessageV1Schema } from '@happier-dev/protocol';
import type { OpenedSessionStateSnapshot, OpenedSessionStateVersions } from './snapshotSync';
import { createSessionTranscriptStoredContentUnavailableError } from './sessionTranscriptStoredContentUnavailable';
import { openSessionMessageContent, SessionStoredContentError, type SessionStoredContentCryptoContext } from '@/session/transport/encryption/sessionEncryptionContext';
import { readRecord, normalizeBoundedInt, type SessionTranscriptActionItem } from './sessionTranscriptActionInput';
import { fetchEncryptedTranscriptMessagesPage, type RawTranscriptRow } from '@/session/replay/fetchEncryptedTranscriptMessages';
import {
    createTranscriptHistoryNormalizationSequenceState,
    extractCompactRow,
    isMemoryArtifactDecryptedRow,
    shouldSuppressTranscriptItemForEmptyCanonicalTurnDiff,
    tryResolveDecryptedTranscriptPayload,
    type TranscriptHistoryNormalizationSequenceState,
} from '@/session/services/transcript/transcriptHistoryRows';

type ServerBackedSessionTranscriptStoreParams = Readonly<{
    token: string;
    sessionId: string;
    readOpenedSessionState?: (versions: OpenedSessionStateVersions) => Promise<OpenedSessionStateSnapshot>;
}> & SessionStoredContentCryptoContext;

function rowToOpenedMessage(row: RawTranscriptRow, params: ServerBackedSessionTranscriptStoreParams) {
    const parsed = SessionMessageV1Schema.safeParse(row);
    if (!parsed.success) throw createSessionTranscriptStoredContentUnavailableError();
    let opened: unknown;
    try {
        opened = openSessionMessageContent({ ...params, content: parsed.data.content });
    } catch (error) {
        if (error instanceof SessionStoredContentError) {
            // Content failure belongs to this row, not the page or lease. Keep
            // its cursor witness without forwarding mismatched/plain content
            // or the unopenable ciphertext through the opened projection.
            return { ...parsed.data, content: { t: 'plain', v: null },
                openFailure: error.code === 'session_content_mode_mismatch' ? 'mode_mismatch' : 'corrupt_or_unopenable' };
        }
        throw error;
    }
    if (!opened || typeof opened !== 'object' || Array.isArray(opened)) {
        return { ...parsed.data, content: { t: 'plain', v: null }, openFailure: 'corrupt_or_unopenable' };
    }
    return { ...parsed.data, content: { t: 'plain', v: opened } };
}

function parseSeqCursor(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
    }
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function isTailCursor(value: unknown): boolean {
    return typeof value === 'string' && value.trim() === 'tail';
}

function rowToTranscriptItem(
    row: RawTranscriptRow,
    index: number,
    ctx: ServerBackedSessionTranscriptStoreParams['ctx'],
    sequenceState: TranscriptHistoryNormalizationSequenceState,
): SessionTranscriptActionItem | null {
    const seq = typeof row.seq === 'number' && Number.isFinite(row.seq) ? Math.floor(row.seq) : undefined;
    const decrypted = tryResolveDecryptedTranscriptPayload({ content: row.content, ctx });
    if (decrypted && shouldSuppressTranscriptItemForEmptyCanonicalTurnDiff(decrypted, sequenceState)) {
        return null;
    }
    const compact = decrypted && !isMemoryArtifactDecryptedRow(decrypted)
        ? extractCompactRow({
            decrypted,
            createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
            fallbackId: typeof seq === 'number' ? String(seq) : String(index),
        })
        : null;
    return {
        id: typeof seq === 'number' ? String(seq) : String(index),
        ...(typeof seq === 'number' ? { seq } : {}),
        ...(typeof row.createdAt === 'number' ? { createdAt: row.createdAt } : {}),
        ...(compact?.text ? { text: compact.text } : {}),
        content: row.content,
    };
}

function limitItemsByEncodedBytes(
    items: readonly SessionTranscriptActionItem[],
    maxBytes: number,
): Readonly<{ items: readonly SessionTranscriptActionItem[]; truncated: boolean }> {
    const limited: SessionTranscriptActionItem[] = [];
    let bytes = 0;
    for (const item of items) {
        const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
        if (limited.length > 0 && bytes + itemBytes > maxBytes) {
            return { items: limited, truncated: true };
        }
        limited.push(item);
        bytes += itemBytes;
        if (bytes >= maxBytes) {
            return { items: limited, truncated: items.length > limited.length };
        }
    }
    return { items: limited, truncated: false };
}

function cursorForSequence(seq: unknown): string | null {
    return typeof seq === 'number' && Number.isFinite(seq) ? String(seq) : null;
}

function cursorForLastEmittedItem(items: readonly SessionTranscriptActionItem[]): string | null {
    return cursorForSequence(items.at(-1)?.seq);
}

export function createServerBackedSessionTranscriptStore(
    params: ServerBackedSessionTranscriptStoreParams,
): FileBackedTranscriptSessionStore<SessionTranscriptActionItem> {
    let tailCursor: string | null = null;
    const sequenceState = createTranscriptHistoryNormalizationSequenceState();

    const rowsToTranscriptItems = (
        rows: readonly RawTranscriptRow[],
    ): SessionTranscriptActionItem[] => rows.flatMap((row, index) => {
        const item = rowToTranscriptItem(row, index, params.ctx, sequenceState);
        return item ? [item] : [];
    });

    return {
        warm: async () => undefined,
        dispose: async () => undefined,
        setLifecycleState: async () => undefined,
        async pageOlder(rawParams?: unknown): Promise<FileBackedTranscriptPageResult<SessionTranscriptActionItem>> {
            const input = readRecord(rawParams);
            const maxItems = normalizeBoundedInt(input.maxItems, 100, 500);
            const maxBytes = normalizeBoundedInt(input.maxBytes, 64 * 1024, 1_000_000);
            const page = await fetchEncryptedTranscriptMessagesPage({
                token: params.token,
                sessionId: params.sessionId,
                limit: maxItems,
                ...(parseSeqCursor(input.cursor) !== undefined ? { beforeSeq: parseSeqCursor(input.cursor) } : {}),
            });
            tailCursor = typeof page.nextAfterSeq === 'number' ? String(page.nextAfterSeq) : tailCursor;
            const limited = limitItemsByEncodedBytes(
                rowsToTranscriptItems(page.messages),
                maxBytes,
            );
            const emittedCursor = cursorForLastEmittedItem(limited.items);
            return {
                items: limited.items,
                nextCursor: limited.truncated
                    ? emittedCursor ?? (typeof page.nextBeforeSeq === 'number' ? String(page.nextBeforeSeq) : null)
                    : typeof page.nextBeforeSeq === 'number' ? String(page.nextBeforeSeq) : null,
                hasMore: page.hasMore || limited.truncated,
                tailCursor,
                truncated: page.hasMore || limited.truncated,
            };
        },
        async readAfter(rawParams?: unknown): Promise<FileBackedTranscriptReadAfterResult<SessionTranscriptActionItem>> {
            const input = readRecord(rawParams);
            const openedProjection = input.projection === 'openedMessagesV1';
            const readSessionState = async () => {
                if (!params.readOpenedSessionState) throw createSessionTranscriptStoredContentUnavailableError();
                return await params.readOpenedSessionState({
                    agentStateVersion: typeof input.agentStateVersion === 'number' ? input.agentStateVersion : -1,
                    sharedMetadataVersion: typeof input.sharedMetadataVersion === 'number' ? input.sharedMetadataVersion : -1,
                });
            };
            const maxItems = normalizeBoundedInt(input.maxItems, 100, 500);
            const maxBytes = normalizeBoundedInt(input.maxBytes, 64 * 1024, 1_000_000);
            if (isTailCursor(input.cursor)) {
                const page = await fetchEncryptedTranscriptMessagesPage({
                    token: params.token,
                    sessionId: params.sessionId,
                    limit: 1,
                });
                tailCursor = cursorForSequence(page.messages[0]?.seq) ?? '0';
                return {
                    items: [],
                    nextCursor: tailCursor,
                    truncated: false,
                    ...(openedProjection ? { projection: 'openedMessagesV1' as const, ...await readSessionState() } : {}),
                };
            }
            const afterSeq = parseSeqCursor(input.cursor);
            const page = await fetchEncryptedTranscriptMessagesPage({
                token: params.token,
                sessionId: params.sessionId,
                limit: maxItems,
                ...(afterSeq !== undefined ? { afterSeq } : {}),
            });
            tailCursor = typeof page.nextAfterSeq === 'number' ? String(page.nextAfterSeq) : tailCursor;
            const limited = limitItemsByEncodedBytes(
                openedProjection ? page.messages.map((row) => rowToOpenedMessage(row, params)) : rowsToTranscriptItems(page.messages),
                maxBytes,
            );
            const emittedCursor = cursorForLastEmittedItem(limited.items);
            return {
                items: limited.items,
                nextCursor: limited.truncated
                    ? emittedCursor ?? (typeof page.nextAfterSeq === 'number' ? String(page.nextAfterSeq) : null)
                    : typeof page.nextAfterSeq === 'number' ? String(page.nextAfterSeq) : emittedCursor,
                truncated: page.hasMore || limited.truncated,
                ...(openedProjection ? { projection: 'openedMessagesV1' as const, ...await readSessionState() } : {}),
            };
        },
        getTailCursor: () => tailCursor,
        subscribe: (_listener?: FileBackedTranscriptSubscriptionListener<SessionTranscriptActionItem>) => () => undefined,
        getTitle: async () => null,
        getWorkingDirectory: async () => null,
        getActivity: async () => null,
        getPreview: async () => null,
    };
}
