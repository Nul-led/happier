import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    files: new Map<string, number[]>(),
    closeError: null as Error | null,
}));
vi.mock('expo-file-system', () => ({
    Paths: { cache: 'file:///cache' },
    Directory: class Directory {
        uri: string;
        constructor(...parts: Array<string | { uri: string }>) {
            this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
        }
        create() {}
    },
    File: class File {
        uri: string;
        constructor(directory: { uri: string }, name: string) { this.uri = `${directory.uri}/${name}`; }
        create() {
            if (fs.files.has(this.uri)) throw new Error('File already exists');
            fs.files.set(this.uri, []);
        }
        open() {
            return {
                offset: 0,
                writeBytes: (bytes: Uint8Array) => fs.files.get(this.uri)!.push(...bytes),
                close: () => { if (fs.closeError) throw fs.closeError; },
            };
        }
        delete() { fs.files.delete(this.uri); }
    },
}));

import { createNativeCacheFileSink } from './nativeCacheFileSink';

describe('native cache file destinations', () => {
    beforeEach(() => { fs.files.clear(); fs.closeError = null; });

    it('keeps simultaneous and repeated downloads distinct while preserving the extension', async () => {
        const input = { directoryName: 'happier-downloads', name: 'recording.mp4' };
        const first = await createNativeCacheFileSink(input);
        const second = await createNativeCacheFileSink(input);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        if (!first.ok || !second.ok) throw new Error('expected sinks');
        expect(first.sink.fileUri).not.toBe(second.sink.fileUri);
        expect(first.sink.fileUri).toMatch(/\.mp4$/);
        expect(second.sink.fileUri).toMatch(/\.mp4$/);
        await first.sink.writeBytes(new Uint8Array([1, 2]));
        await second.sink.writeBytes(new Uint8Array([3]));
        await first.sink.close();
        await first.sink.close();
        await first.sink.cleanup();
        expect(fs.files.get(second.sink.fileUri)).toEqual([3]);
    });

    it('surfaces a close failure so an incomplete file cannot be reported as saved', async () => {
        const result = await createNativeCacheFileSink({ directoryName: 'happier-downloads', name: 'a.mp4' });
        if (!result.ok) throw new Error(result.error);
        fs.closeError = new Error('Disk close failed');
        await expect(result.sink.close()).rejects.toThrow('Disk close failed');
    });

    it('preserves the media extension when the display name needs truncation', async () => {
        const result = await createNativeCacheFileSink({ directoryName: 'happier-downloads', name: `${'recording'.repeat(20)}.mp4` });
        if (!result.ok) throw new Error(result.error);
        expect(result.sink.fileUri).toMatch(/\.mp4$/);
    });
});
