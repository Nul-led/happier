import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type SafeStorageBoundary = Readonly<{
    isEncryptionAvailable: () => boolean;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
    getSelectedStorageBackend?: () => string;
}>;

export type ElectronSecureStorageDependencies = Readonly<{
    userDataPath: () => string;
    crypto: SafeStorageBoundary;
}>;

const STORAGE_DIRECTORY = ['device-local-storage', 'v1'] as const;
const KEY_DOMAIN = 'happier.desktop.device-local-storage.v1\0';

function opaqueScopedKey(key: string): string {
    return createHash('sha256').update(KEY_DOMAIN).update(key).digest('hex');
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class ElectronSecureStorage {
    readonly #dependencies: ElectronSecureStorageDependencies;

    constructor(dependencies: ElectronSecureStorageDependencies) {
        this.#dependencies = dependencies;
    }

    #assertEncryptionAvailable(): void {
        if (!this.#dependencies.crypto.isEncryptionAvailable()) {
            throw new Error('Electron safeStorage encryption is unavailable');
        }
        if (this.#dependencies.crypto.getSelectedStorageBackend?.() === 'basic_text') {
            throw new Error('Electron safeStorage has no protected OS credential backend');
        }
    }

    #pathFor(key: string): string {
        return join(this.#dependencies.userDataPath(), ...STORAGE_DIRECTORY, `${opaqueScopedKey(key)}.bin`);
    }

    async read(key: string): Promise<string | null> {
        this.#assertEncryptionAvailable();
        try {
            return this.#dependencies.crypto.decryptString(await readFile(this.#pathFor(key)));
        } catch (error) {
            if (isMissingFile(error)) return null;
            throw error;
        }
    }

    async write(key: string, value: string): Promise<void> {
        this.#assertEncryptionAvailable();
        const destination = this.#pathFor(key);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') {
            await chmod(dirname(destination), 0o700);
        }
        const temporary = `${destination}.${randomUUID()}.tmp`;
        const ciphertext = this.#dependencies.crypto.encryptString(value);
        const handle = await open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(ciphertext);
            await handle.sync();
            await handle.close();
            await rename(temporary, destination);
            if (process.platform !== 'win32') {
                await chmod(destination, 0o600);
            }
        } catch (error) {
            await handle.close().catch(() => {});
            await unlink(temporary).catch(() => {});
            throw error;
        }
    }

    async remove(key: string): Promise<void> {
        this.#assertEncryptionAvailable();
        await rm(this.#pathFor(key), { force: true });
    }
}
