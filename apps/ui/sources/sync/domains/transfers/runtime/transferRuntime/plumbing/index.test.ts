import { describe, expect, it, vi } from 'vitest';

import { prepareBulkJsonPayloadForUpload } from './prepareBulkJsonPayloadForUpload';
import { uploadBulkPayloadFromFile } from './uploadBulkPayloadFromFile';

describe('bulk transfer low-level helpers', () => {
    it('uploads a file-backed payload and closes the reader after finalizing', async () => {
        const close = vi.fn(async () => {});
        const readBytes = vi.fn(async (offset: number, length: number) =>
            new TextEncoder().encode('hello').subarray(offset, offset + length),
        );
        const sendChunk = vi.fn(async (_request: {
            uploadId: string;
            index: number;
            payloadBase64: string;
            encryptedDataKeyEnvelopeBase64: string;
        }) => ({ success: true as const }));
        const finalize = vi.fn(async (_request: { uploadId: string }) => ({
            success: true as const,
            remotePath: '/tmp/hello.txt',
        }));

        await expect(uploadBulkPayloadFromFile({
            fileReader: {
                sizeBytes: 5,
                readBytes,
                close,
            },
            init: async () => ({
                success: true as const,
                uploadId: 'upload-1',
                chunkSizeBytes: 2,
                recipientPublicKeyBase64: Buffer.alloc(32, 9).toString('base64'),
            }),
            sendChunk,
            finalize,
        })).resolves.toEqual({
            success: true,
            remotePath: '/tmp/hello.txt',
        });

        expect(readBytes).toHaveBeenCalledTimes(3);
        expect(sendChunk).toHaveBeenCalledTimes(3);
        expect(finalize).toHaveBeenCalledWith({ uploadId: 'upload-1' });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('fails closed when preparing a JSON payload that exceeds the bulk JSON max bytes', () => {
        const previous = process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES;
        process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES = '8';

        try {
            expect(prepareBulkJsonPayloadForUpload({
                kind: 'metadata',
                values: ['a', 'b'],
            })).toEqual({
                ok: false,
                error: expect.stringContaining('exceeds'),
            });
        } finally {
            if (previous === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES;
            } else {
                process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES = previous;
            }
        }
    });

    it('rejects oversized JSON payloads without calling JSON.stringify (preflight avoids unbounded memory)', () => {
        const previous = process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES;
        process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES = '1';

        const original = JSON.stringify;
        try {
            // If preparation stringifies before enforcing the limit, this test will fail.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            JSON.stringify = (() => {
                throw new Error('JSON.stringify should not be called for oversized payloads');
            }) as any;

            expect(prepareBulkJsonPayloadForUpload({ a: 'b' })).toEqual({
                ok: false,
                error: expect.stringContaining('exceeds'),
            });
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            JSON.stringify = original as any;
            if (previous === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES;
            } else {
                process.env.EXPO_PUBLIC_HAPPIER_BULK_TRANSFER_JSON_MAX_BYTES = previous;
            }
        }
    });
});
