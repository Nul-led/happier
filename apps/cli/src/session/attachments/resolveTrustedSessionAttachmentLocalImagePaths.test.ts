import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
    resolveTrustedSessionAttachmentLocalImagePaths,
    verifySessionStructuredImageInput,
} from './resolveTrustedSessionAttachmentLocalImagePaths';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'happier-trusted-attachments-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

describe('resolveTrustedSessionAttachmentLocalImagePaths', () => {
    it('refuses plugin image disclosure outside declared Session READ scope or Account encryption mode', async () => {
        const cwd = await createTempDir();
        const mediaPath = '.happier/uploads/artifacts/session-1/capture-1/screen.png';
        const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
        await mkdir(dirname(join(cwd, mediaPath)), { recursive: true });
        await writeFile(join(cwd, mediaPath), bytes);
        const image = {
            id: 'session-media:capture-1', kind: 'localImage', path: mediaPath, mimeType: 'image/png',
            sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength,
            provenance: { kind: 'sessionMediaArtifact', sessionId: 'session-1', storage: 'session' },
        };
        const base = {
            cwd, sessionId: 'session-1', image, maxBytes: bytes.byteLength,
            pluginAccess: {
                scopes: [{ access: ['read' as const], machineIds: ['machine-1'] }],
                session: { id: 'session-1', machineId: 'machine-1' },
                accountEncryptionMode: 'plain' as const,
                sessionEncryptionMode: 'plain' as const,
            },
        };
        expect(await verifySessionStructuredImageInput(base)).toMatchObject({ status: 'verified', bytes });
        const refusals = await Promise.all([verifySessionStructuredImageInput({ ...base, pluginAccess: {
            ...base.pluginAccess, session: { id: 'session-1', machineId: 'foreign-machine' },
        } }), verifySessionStructuredImageInput({ ...base, pluginAccess: {
            ...base.pluginAccess, scopes: [{ access: ['control' as const] }],
        } }), verifySessionStructuredImageInput({ ...base, pluginAccess: {
            ...base.pluginAccess, sessionEncryptionMode: 'e2ee' as const,
        } }), verifySessionStructuredImageInput({ ...base, pluginAccess: {
            ...base.pluginAccess, accountEncryptionMode: 'e2ee' as const,
        } })]);
        expect(refusals.map((result) => result.status)).toEqual(['untrusted', 'untrusted', 'untrusted', 'untrusted']);
    });
    it('verifies native Session media without browser provenance and refuses scope, integrity and bucket substitutions', async () => {
        const cwd = await createTempDir();
        const mediaPath = '.happier/uploads/artifacts/session-1/capture-1/screen.png';
        const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
        await mkdir(dirname(join(cwd, mediaPath)), { recursive: true });
        await writeFile(join(cwd, mediaPath), bytes);
        const image = {
            id: 'session-media:capture-1', kind: 'localImage', path: mediaPath, mimeType: 'image/png',
            sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength,
            provenance: { kind: 'sessionMediaArtifact', sessionId: 'session-1', storage: 'session' },
        };
        const verify = (candidate: typeof image, sessionId = 'session-1') => verifySessionStructuredImageInput({
            cwd, sessionId, image: candidate, maxBytes: bytes.byteLength,
        });
        expect(await verify(image)).toMatchObject({ status: 'verified', bytes, mimeType: 'image/png' });
        expect(await verify(image, 'session-2')).toEqual({ status: 'untrusted' });
        expect(await verify({ ...image, sha256: '0'.repeat(64) })).toEqual({ status: 'untrusted' });
        expect(await verify({ ...image, sizeBytes: bytes.byteLength + 1 })).toEqual({ status: 'untrusted' });
        expect(await verify({ ...image, mimeType: 'image/jpeg' })).toEqual({ status: 'invalid' });
        const uploadPath = '.happier/uploads/messages/message-1/screen.png';
        await mkdir(dirname(join(cwd, uploadPath)), { recursive: true });
        await writeFile(join(cwd, uploadPath), bytes);
        expect(await verify({ ...image, path: uploadPath })).toEqual({ status: 'untrusted' });
        await writeFile(join(cwd, 'outside.png'), bytes);
        const linkPath = '.happier/uploads/artifacts/session-1/capture-1/link.png';
        await symlink(join(cwd, 'outside.png'), join(cwd, linkPath), 'file');
        expect(await verify({ ...image, path: linkPath })).toEqual({ status: 'untrusted' });
    });
    it('reads browser media only inside the exact Session bucket and checks actual bytes', async () => {
        const cwd = await createTempDir();
        const mediaPath = '.happier/uploads/artifacts/session-1/message-1/screen.png';
        const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
        await mkdir(dirname(join(cwd, mediaPath)), { recursive: true });
        await writeFile(join(cwd, mediaPath), bytes);
        const image = {
            id: 'browser-media', kind: 'localImage', path: mediaPath, mimeType: 'image/png',
            sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength,
            provenance: { kind: 'browserSessionMedia', sessionId: 'session-1', storage: 'session' },
        };
        expect(await verifySessionStructuredImageInput({ cwd, sessionId: 'session-1', image, maxBytes: 100 })).toMatchObject({ status: 'verified', bytes });
        expect(await verifySessionStructuredImageInput({ cwd, sessionId: 'session-2', image, maxBytes: 100 })).toEqual({ status: 'untrusted' });
        expect(await verifySessionStructuredImageInput({ cwd, sessionId: 'session-1', image: { ...image, sha256: '0'.repeat(64) }, maxBytes: 100 })).toEqual({ status: 'untrusted' });
        expect(await verifySessionStructuredImageInput({ cwd, sessionId: 'session-1', image: { ...image, path: '../secret.png' }, maxBytes: 100 })).toEqual({ status: 'untrusted' });
        // Even matching declared bytes cannot turn a Session-bucket symlink into an outside read.
        await writeFile(join(cwd, 'outside.png'), bytes);
        const symlinkPath = '.happier/uploads/artifacts/session-1/message-1/link.png';
        await symlink(join(cwd, 'outside.png'), join(cwd, symlinkPath), 'file');
        expect(await verifySessionStructuredImageInput({ cwd, sessionId: 'session-1', image: { ...image, path: symlinkPath }, maxBytes: 100 })).toEqual({ status: 'untrusted' });
    });
    it('returns exact bytes, sniffed MIME, and filename only for a verified admitted image input', async () => {
        const cwd = await createTempDir();
        const uploadPath = '.happier/uploads/messages/message-1/screen.png';
        const bytes = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x00,
        ]);
        await mkdir(dirname(join(cwd, uploadPath)), { recursive: true });
        await writeFile(join(cwd, uploadPath), bytes);

        await expect(verifySessionStructuredImageInput({
            cwd,
            image: {
                id: 'image-1',
                kind: 'localImage',
                path: uploadPath,
                mimeType: 'image/png',
                sha256: createHash('sha256').update(bytes).digest('hex'),
                sizeBytes: bytes.byteLength,
                provenance: { kind: 'sessionAttachmentUpload' },
            },
            maxBytes: bytes.byteLength,
        })).resolves.toEqual({
            status: 'verified',
            bytes,
            mimeType: 'image/png',
            filename: 'screen.png',
        });

        await expect(verifySessionStructuredImageInput({
            cwd,
            image: {
                id: 'image-1',
                kind: 'localImage',
                path: uploadPath,
                mimeType: 'image/jpeg',
                sha256: createHash('sha256').update(bytes).digest('hex'),
                sizeBytes: bytes.byteLength,
                provenance: { kind: 'sessionAttachmentUpload' },
            },
            maxBytes: bytes.byteLength,
        })).resolves.toEqual({ status: 'invalid' });
    });

    it('trusts uploaded local image paths only when the declared file hash matches', async () => {
        const cwd = await createTempDir();
        const uploadPath = '.happier/uploads/messages/message-1/screen.png';
        const content = 'fake image bytes';
        await mkdir(dirname(join(cwd, uploadPath)), { recursive: true });
        await writeFile(join(cwd, uploadPath), content);

        await expect(resolveTrustedSessionAttachmentLocalImagePaths({
            cwd,
            metadata: {
                happier: {
                    kind: 'attachments.v1',
                    payload: {
                        attachments: [
                            {
                                path: uploadPath,
                                mimeType: 'image/png',
                                sizeBytes: content.length,
                                sha256: sha256(content),
                            },
                        ],
                    },
                },
            },
        })).resolves.toEqual(new Set([uploadPath]));
    });

    it('does not trust uploaded local image paths when the declared hash is wrong', async () => {
        const cwd = await createTempDir();
        const uploadPath = '.happier/uploads/messages/message-1/screen.png';
        await mkdir(dirname(join(cwd, uploadPath)), { recursive: true });
        await writeFile(join(cwd, uploadPath), 'fake image bytes');

        await expect(resolveTrustedSessionAttachmentLocalImagePaths({
            cwd,
            metadata: {
                happier: {
                    kind: 'attachments.v1',
                    payload: {
                        attachments: [
                            {
                                path: uploadPath,
                                mimeType: 'image/png',
                                sizeBytes: 16,
                                sha256: sha256('different content'),
                            },
                        ],
                    },
                },
            },
        })).resolves.toEqual(new Set());
    });

    it('verifies an image retained beside review metadata through the canonical attachment envelope reader', async () => {
        const cwd = await createTempDir();
        const uploadPath = '.happier/uploads/messages/message-1/screen.png';
        const content = 'fake image bytes';
        await mkdir(dirname(join(cwd, uploadPath)), { recursive: true });
        await writeFile(join(cwd, uploadPath), content);

        await expect(resolveTrustedSessionAttachmentLocalImagePaths({
            cwd,
            metadata: {
                happier: {
                    kind: 'review_comments.v1',
                    payload: { comments: [] },
                },
                happierAttachments: {
                    kind: 'attachments.v1',
                    payload: {
                        attachments: [
                            {
                                path: uploadPath,
                                mimeType: 'image/png',
                                sizeBytes: content.length,
                                sha256: sha256(content),
                            },
                        ],
                    },
                },
            },
        })).resolves.toEqual(new Set([uploadPath]));
    });
});
