import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTransferPathAllowanceRegistry } from '@/transfers/targets/createTransferPathAllowanceRegistry';

import { createSessionMediaScreenshotWriter } from './screenshotMedia';

const INPUT = {
    browserSessionId: 'browser_session_1',
    viewId: 'view_1',
    navigationGeneration: 3,
    pngBase64: 'QkFTRTY0UE5H',
} as const;

describe('session media screenshot writer', () => {
    it('returns a scoped, hash-verifiable reference to the actual persisted PNG', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'happier-browser-media-'));
        try {
            const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
            const writer = createSessionMediaScreenshotWriter({ workingDirectory: cwd,
                pathAllowanceRegistry: createTransferPathAllowanceRegistry(),
                resolveTarget: () => ({ sessionId: 'session-1', messageLocalId: 'capture' }),
            });
            const result = await writer.write({ ...INPUT, pngBase64: png.toString('base64') });
            expect(result).toMatchObject({ ok: true, media: { width: 1, height: 1,
                file: { sessionId: 'session-1', storage: 'session', sha256: createHash('sha256').update(png).digest('hex'), mimeType: 'image/png' } } });
            if (!result.ok || !result.media.file) throw new Error('Expected persisted media');
            expect(await readFile(join(cwd, result.media.file.path))).toEqual(png);
        } finally { await rm(cwd, { recursive: true, force: true }); }
    });
    it('fails closed for bytes that are not a PNG screenshot', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'happier-browser-media-'));
        try {
            const writer = createSessionMediaScreenshotWriter({
                workingDirectory: cwd,
                pathAllowanceRegistry: createTransferPathAllowanceRegistry(),
                resolveTarget: () => ({ sessionId: 's', messageLocalId: 'm' }),
            });
            expect(await writer.write(INPUT)).toMatchObject({ ok: false, reason: 'capture_failed' });
        } finally { await rm(cwd, { recursive: true, force: true }); }
    });
});
