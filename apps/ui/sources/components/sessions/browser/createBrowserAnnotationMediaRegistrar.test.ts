import { describe, expect, it, vi } from 'vitest';
import { createBrowserAnnotationMediaRegistrar } from './createBrowserAnnotationMediaRegistrar';

// Genuine daemon-upload boundary: injected responses below retain the real registrar.
vi.mock('@/sync/domains/transfers/ops/uploadSessionAttachment', () => ({ sessionAttachmentsUploadFile: vi.fn() }));

describe('Session browser annotation media registrar', () => {
    const config = { uploadLocation: 'workspace', workspaceRelativeDir: '.happier/uploads',
        vcsIgnoreStrategy: 'none', vcsIgnoreWritesEnabled: false, maxFileBytes: 1024 } as const;
    const input = { snapshot: { bytes: new Uint8Array([1, 2]), mimeType: 'image/png', width: 10, height: 20, sizeBytes: 2 },
        browserSessionId: 'browser-view-scope', viewId: 'view-1', navigationGeneration: 1, capturedAtMs: 100 } as const;

    it('returns the transfer-owned hash and location under the actual Happier Session', async () => {
        const registrar = createBrowserAnnotationMediaRegistrar({ sessionId: 'session-1', config,
            uploadFile: async (request) => {
                expect(request.sessionId).toBe('session-1');
                expect(request.file).toMatchObject({ kind: 'memory', bytes: input.snapshot.bytes, mimeType: 'image/png' });
                return { success: true, path: '.happier/uploads/messages/message-1/annotation.png', sha256: 'a'.repeat(64), sizeBytes: 2 };
            },
        });
        expect(await registrar(input)).toMatchObject({ mediaId: 'a'.repeat(64), width: 10, height: 20,
            file: { sessionId: 'session-1', storage: 'session', sha256: 'a'.repeat(64), path: '.happier/uploads/messages/message-1/annotation.png' } });
    });

    it('returns no reference when transfer fails or returns malformed integrity metadata', async () => {
        for (const uploadFile of [
            async () => ({ success: false as const, error: 'offline' }),
            async () => ({ success: true as const, path: 'annotation.png', sha256: 'invalid', sizeBytes: 2 }),
            async () => ({ success: true as const, path: '/private/annotation.png', sha256: 'a'.repeat(64), sizeBytes: 2 }),
        ]) {
            expect(await createBrowserAnnotationMediaRegistrar({ sessionId: 'session-1', config, uploadFile })(input)).toBeNull();
        }
    });
});
