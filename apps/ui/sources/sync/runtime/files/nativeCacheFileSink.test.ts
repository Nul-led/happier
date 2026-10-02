import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createNativeCacheFileSink', () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('offers a local PDF to the native OS share/open boundary and reports unavailable sharing', async () => {
        const shareAsync = vi.fn(async () => {});
        let available = true;
        vi.doMock('expo-sharing', () => ({ isAvailableAsync: async () => available, shareAsync }));
        const { shareNativeCacheFile } = await import('./nativeCacheFileSink');
        await expect(shareNativeCacheFile('file:///cache/document.pdf', 'application/pdf')).resolves.toBe(true);
        expect(shareAsync).toHaveBeenCalledWith('file:///cache/document.pdf', { mimeType: 'application/pdf' });
        available = false;
        await expect(shareNativeCacheFile('file:///cache/document.pdf', 'application/pdf')).resolves.toBe(false);
        expect(shareAsync).toHaveBeenCalledTimes(1);
    });

    it('deletes a stale deterministic cache file before creating a replacement', async () => {
        const createDirectory = vi.fn();
        const deleteFile = vi.fn();
        const create = vi.fn();
        const close = vi.fn();
        const writeBytes = vi.fn();
        const open = vi.fn(() => ({ close, writeBytes, offset: null }));

        class Directory {
            readonly uri: string;

            constructor(parent: { uri: string } | string, path?: string) {
                const parentUri = typeof parent === 'string' ? parent : parent.uri;
                this.uri = `${parentUri.replace(/\/+$/, '')}/${path ?? ''}`;
            }

            create = createDirectory;
        }

        class File {
            readonly uri: string;

            constructor(parent: { uri: string } | string, path?: string) {
                const parentUri = typeof parent === 'string' ? parent : parent.uri;
                this.uri = path ? `${parentUri.replace(/\/+$/, '')}/${path}` : parentUri;
            }

            delete = deleteFile;
            create = create;
            open = open;
        }

        vi.doMock('expo-file-system', () => ({
            Paths: { cache: { uri: 'file:///cache/' } },
            Directory,
            File,
            makeDirectoryAsync: vi.fn(() => {
                throw new Error('deprecated makeDirectoryAsync must not be used');
            }),
        }));

        const { createNativeCacheFileSink } = await import('./nativeCacheFileSink');
        const sink = await createNativeCacheFileSink({
            directoryName: 'happier-session-file-previews',
            fileName: 'same-preview.png',
        });

        expect(sink.ok).toBe(true);
        expect(createDirectory).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
        expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0] ?? 0);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('surfaces exact cache-file removal failures and accepts a later confirmed absence', async () => {
        const deleteFile = vi.fn()
            .mockImplementationOnce(() => { throw new Error('file busy'); })
            .mockImplementationOnce(() => { throw new Error('already absent'); });
        let exists = true;
        class File {
            readonly uri: string;
            constructor(uri: string) { this.uri = uri; }
            get exists() { return exists; }
            delete = deleteFile;
        }
        vi.doMock('expo-file-system', () => ({ File }));

        const { removeNativeCacheFileCustody } = await import('./nativeCacheFileSink');
        await expect(removeNativeCacheFileCustody('file:///cache/sensitive.zip')).rejects.toThrow('file busy');

        exists = false;
        await expect(removeNativeCacheFileCustody('file:///cache/sensitive.zip')).resolves.toBeUndefined();
        expect(deleteFile).toHaveBeenCalledTimes(2);
    });

    it('surfaces native file-system import failures instead of claiming custody was removed', async () => {
        vi.doMock('expo-file-system', () => { throw new Error('native file system unavailable'); });
        const { removeNativeCacheFileCustody } = await import('./nativeCacheFileSink');
        await expect(removeNativeCacheFileCustody('file:///cache/sensitive.zip'))
            .rejects.toThrow();
    });
});
