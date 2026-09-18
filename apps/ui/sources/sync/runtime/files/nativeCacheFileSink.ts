import { sanitizeFileUriSegment } from './fileUriPath';

type ExpoFileSystemModule = Readonly<{
    Directory: new (parent: ExpoFileSystemDirectory | string, name?: string) => ExpoFileSystemDirectory;
    File: new (parent: ExpoFileSystemDirectory | string, name?: string) => ExpoFileSystemFile;
    Paths?: Readonly<{
        cache?: ExpoFileSystemDirectory | string | null;
    }>;
}>;

type ExpoFileSystemDirectory = Readonly<{
    uri: string;
    create: (options?: { intermediates?: boolean; idempotent?: boolean }) => void;
}>;

type ExpoFileSystemFile = Readonly<{
    uri: string;
    exists?: boolean;
    delete: () => void;
    create: () => void;
    open: () => ExpoFileSystemFileHandle;
}>;

type ExpoFileSystemFileHandle = {
    offset?: number | null;
    close: () => void;
    writeBytes: (bytes: Uint8Array) => void;
};

export type NativeCacheFileSink = Readonly<{
    fileUri: string;
    writeBytes: (bytes: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    cleanup: () => Promise<void>;
}>;

/** Removes one exact cache file after its creating component/process-local closure is gone. */
export async function removeNativeCacheFileCustody(fileUri: string): Promise<void> {
    const FileSystem = await import('expo-file-system') as ExpoFileSystemModule;
    const file = new FileSystem.File(fileUri);
    try {
        file.delete();
    } catch (error) {
        // Expo's modern File API reports absence through `exists`. Absence is
        // the idempotent success case; every other failure must remain visible
        // so the caller retains the only persisted custody locator for retry.
        if (file.exists === false) return;
        throw error;
    }
}

export async function createNativeCacheFileSink(input: Readonly<{
    directoryName: string;
    fileName: string;
}>): Promise<
    | Readonly<{ ok: true } & NativeCacheFileSink>
    | Readonly<{ ok: false; error: string }>
> {
    try {
        const FileSystem = await import('expo-file-system') as ExpoFileSystemModule;
        const cachePath = FileSystem.Paths?.cache ?? null;
        if (!cachePath) {
            return { ok: false, error: 'No cache directory available' };
        }

        const directoryName = sanitizeFileUriSegment(input.directoryName, 'happier-cache');
        const fileName = sanitizeFileUriSegment(input.fileName, 'preview');
        const cacheDirectory = typeof cachePath === 'string'
            ? new FileSystem.Directory(cachePath)
            : cachePath;
        const directory = new FileSystem.Directory(cacheDirectory, directoryName);
        directory.create({ intermediates: true, idempotent: true });

        const file = new FileSystem.File(directory, fileName);
        try {
            file.delete();
        } catch {}
        file.create();
        const handle = file.open();
        if (typeof handle.offset === 'number' || handle.offset === null) {
            handle.offset = 0;
        }

        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            try {
                handle.close();
            } catch {}
        };

        const cleanup = async () => {
            try {
                await close();
            } catch {}
            try {
                file.delete();
            } catch {}
        };

        return {
            ok: true,
            fileUri: file.uri,
            writeBytes: async (bytes) => {
                handle.writeBytes(bytes);
            },
            close,
            cleanup,
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to create cache file sink' };
    }
}
