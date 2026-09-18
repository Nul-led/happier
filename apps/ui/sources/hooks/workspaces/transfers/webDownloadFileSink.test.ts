import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createWebDownloadFileSink,
    openWebDownloadFileCustody,
    removeWebDownloadFileCustody,
    WEB_DOWNLOAD_MEMORY_FALLBACK_MAX_BYTES,
} from './webDownloadFileSink';

describe('createWebDownloadFileSink', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('writes OPFS chunks incrementally and returns the disk-backed File without constructing a Blob', async () => {
        const file = { name: 'payload.bin', size: 6 } as File;
        const write = vi.fn(async (_bytes: Uint8Array) => {});
        const close = vi.fn(async () => {});
        const abort = vi.fn(async () => {});
        const getFile = vi.fn(async () => file);
        const createWritable = vi.fn(async () => ({ write, close, abort }));
        const getFileHandle = vi.fn(async () => ({ createWritable, getFile }));
        const removeEntry = vi.fn(async () => {});
        const getDirectory = vi.fn(async () => ({ getFileHandle, removeEntry }));
        vi.stubGlobal('navigator', { storage: { getDirectory } });
        vi.stubGlobal('Blob', class Blob {
            constructor() {
                throw new Error('whole-payload Blob must not be constructed for OPFS downloads');
            }
        });

        const sink = await createWebDownloadFileSink({
            expectedSizeBytes: 6,
            maxBytes: 100,
            requireFileBacked: true,
        });
        const first = new Uint8Array([1, 2, 3]);
        const second = new Uint8Array([4, 5, 6]);
        await sink.writeBytes(first);
        await sink.writeBytes(second);
        await sink.close();

        expect(write).toHaveBeenNthCalledWith(1, first);
        expect(write).toHaveBeenNthCalledWith(2, second);
        await expect(sink.getFile()).resolves.toBe(file);
        expect(getFile).toHaveBeenCalledTimes(1);

        await sink.cleanup();
        expect(abort).not.toHaveBeenCalled();
        expect(removeEntry).toHaveBeenCalledTimes(1);
    });

    it('aborts and removes a partial OPFS file during cleanup', async () => {
        const write = vi.fn(async (_bytes: Uint8Array) => {});
        const close = vi.fn(async () => {});
        const abort = vi.fn(async () => {});
        const removeEntry = vi.fn(async () => {});
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: async () => ({
                    getFileHandle: async () => ({
                        createWritable: async () => ({ write, close, abort }),
                        getFile: async () => ({ name: 'partial.bin' }) as File,
                    }),
                    removeEntry,
                }),
            },
        });

        const sink = await createWebDownloadFileSink({ expectedSizeBytes: 4, maxBytes: 100 });
        await sink.writeBytes(new Uint8Array([1, 2]));
        await sink.cleanup();

        expect(abort).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
        expect(removeEntry).toHaveBeenCalledTimes(1);
    });

    it('reopens and removes exact OPFS custody after the creating component remounts', async () => {
        const file = { name: 'payload.bin', size: 6 } as File;
        const getFile = vi.fn(async () => file);
        const getFileHandle = vi.fn(async () => ({
            createWritable: async () => ({ write: async () => {}, close: async () => {} }),
            getFile,
        }));
        const removeEntry = vi.fn(async () => {});
        vi.stubGlobal('navigator', {
            storage: { getDirectory: async () => ({ getFileHandle, removeEntry }) },
        });
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

        const sink = await createWebDownloadFileSink({ expectedSizeBytes: 0, maxBytes: 100, requireFileBacked: true });
        expect(sink.fileCustody).toEqual({ kind: 'web_opfs', entryName: '.happier-download-00000000-0000-4000-8000-000000000001.partial' });

        await expect(openWebDownloadFileCustody(sink.fileCustody!)).resolves.toBe(file);
        await removeWebDownloadFileCustody(sink.fileCustody!);

        expect(getFile).toHaveBeenCalledOnce();
        expect(removeEntry).toHaveBeenCalledWith('.happier-download-00000000-0000-4000-8000-000000000001.partial');
    });

    it('surfaces unavailable OPFS and removal failures, while accepting a confirmed missing entry', async () => {
        vi.stubGlobal('navigator', {});
        const custody = { kind: 'web_opfs' as const, entryName: '.happier-download-fixed.partial' };
        await expect(removeWebDownloadFileCustody(custody))
            .rejects.toThrow('File-backed web download is unavailable');

        const removeEntry = vi.fn()
            .mockRejectedValueOnce(new Error('storage busy'))
            .mockRejectedValueOnce(new DOMException('missing', 'NotFoundError'));
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: async () => ({ getFileHandle: async () => ({}), removeEntry }),
            },
        });
        await expect(removeWebDownloadFileCustody(custody)).rejects.toThrow('storage busy');
        await expect(removeWebDownloadFileCustody(custody)).resolves.toBeUndefined();
    });

    it('fails closed above the bounded in-memory fallback when OPFS is unavailable', async () => {
        vi.stubGlobal('navigator', {});

        await expect(createWebDownloadFileSink({
            expectedSizeBytes: WEB_DOWNLOAD_MEMORY_FALLBACK_MAX_BYTES + 1,
            maxBytes: WEB_DOWNLOAD_MEMORY_FALLBACK_MAX_BYTES * 2,
        })).rejects.toThrow('File exceeds the web download size limit');
    });

    it('does not buffer a sensitive package when file-backed output is required', async () => {
        vi.stubGlobal('navigator', {});
        await expect(createWebDownloadFileSink({
            expectedSizeBytes: 2,
            maxBytes: 100,
            requireFileBacked: true,
        })).rejects.toThrow('File-backed web download is unavailable');
    });

    it('uses the bounded fallback when the browser returns an incompatible OPFS root', async () => {
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: async () => ({ getFileHandle: async () => ({}) }),
            },
        });

        const sink = await createWebDownloadFileSink({ expectedSizeBytes: 2, maxBytes: 2 });
        await sink.writeBytes(new Uint8Array([1, 2]));
        await sink.close();

        await expect(sink.getFile()).resolves.toBeInstanceOf(Blob);
    });
});
