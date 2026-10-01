import type { BrowserScreenshotMediaReferenceV1 } from '@happier-dev/protocol';

import { configuration } from '@/configuration';
import type { FilesystemAccessPolicy } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import { decodeSessionMediaBase64 } from '@/session/media/base64';
import { createSessionImageMediaWriter } from '@/session/media/createSessionImageMediaWriter';
import type { TransferPathAllowanceRegistry } from '@/transfers/targets/createTransferPathAllowanceRegistry';

export type BrowserContextScreenshotMediaInput = Readonly<{
    browserSessionId: string;
    viewId: string;
    navigationGeneration: number;
    /** Raw base64-encoded PNG bytes returned by CDP `Page.captureScreenshot` (no data: prefix). */
    pngBase64: string;
}>;

export type BrowserContextScreenshotMediaResult =
    | Readonly<{ ok: true; media: BrowserScreenshotMediaReferenceV1 }>
    | Readonly<{ ok: false; reason: 'capture_failed'; disabledReason?: string }>;

/**
 * Persists a CDP screenshot into durable session media and returns the protocol media reference.
 * The producer depends only on this seam, so the heavy session-media plumbing (path allowance,
 * working directory, budgets) stays out of the producer and the producer stays unit-testable with
 * an in-memory writer.
 */
export type BrowserContextScreenshotMediaWriter = Readonly<{
    write(input: BrowserContextScreenshotMediaInput): Promise<BrowserContextScreenshotMediaResult>;
}>;

export type BrowserContextSessionMediaTarget = Readonly<{
    sessionId: string;
    messageLocalId: string;
}>;

export type SessionMediaScreenshotWriterOptions = Readonly<{
    workingDirectory: string;
    storage?: 'session' | 'daemon';
    pathAllowanceRegistry: TransferPathAllowanceRegistry;
    accessPolicy?: FilesystemAccessPolicy;
    /** Maps a captured view to the owning session/message media bucket. */
    resolveTarget(input: Readonly<{
        browserSessionId: string;
        viewId: string;
        navigationGeneration: number;
    }>): BrowserContextSessionMediaTarget;
    now?: () => number;
}>;

/**
 * Production screenshot writer backed by the canonical `persistSessionMedia` owner. Binary-safe:
 * persistence uses managed filesystem helpers only — no system node / package manager is spawned.
 * Fail-closed: any persistence failure surfaces as `capture_failed` (never a partial/unverified
 * media reference).
 */
export function createSessionMediaScreenshotWriter(
    options: SessionMediaScreenshotWriterOptions,
): BrowserContextScreenshotMediaWriter {
    const writer = createSessionImageMediaWriter({ ...options, storage: options.storage ?? 'session' });

    return {
        async write(input) {
            const target = options.resolveTarget(input);
            const png = decodeSessionMediaBase64(input.pngBase64, configuration.filesUploadMaxFileBytes);
            if (!png.success) return { ok: false, reason: 'capture_failed', disabledReason: png.code };
            return writer.write({ sessionId: target.sessionId, captureId: target.messageLocalId, png: png.bytes });
        },
    };
}
