import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ElectronSecureStorage } from './secureStorage';

test('safeStorage ciphertext is atomically persisted without plaintext keys or values', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'happier-desktop-secure-storage-'));
    const crypto = {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
        decryptString: (value: Buffer) => Buffer.from(value.toString().slice('cipher:'.length), 'base64').toString(),
    };
    const storage = new ElectronSecureStorage({ userDataPath: () => userData, crypto });

    await storage.write('home:https://example.test:token', 'bearer-secret');
    assert.equal(await storage.read('home:https://example.test:token'), 'bearer-secret');

    const storageDir = join(userData, 'device-local-storage', 'v1');
    const files = await readdir(storageDir);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.endsWith('.bin'), true);
    assert.equal(files[0]?.includes('example'), false);
    const bytes = await readFile(join(storageDir, files[0]!));
    assert.equal(bytes.includes(Buffer.from('bearer-secret')), false);
    assert.equal(bytes.includes(Buffer.from('example.test')), false);
    if (process.platform !== 'win32') {
        assert.equal((await stat(storageDir)).mode & 0o777, 0o700);
        assert.equal((await stat(join(storageDir, files[0]!))).mode & 0o777, 0o600);
    }

    await storage.remove('home:https://example.test:token');
    assert.equal(await storage.read('home:https://example.test:token'), null);
    assert.deepEqual(await readdir(storageDir), []);
});

test('writes fail closed when Electron safeStorage is unavailable', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'happier-desktop-secure-storage-'));
    const storage = new ElectronSecureStorage({
        userDataPath: () => userData,
        crypto: {
            isEncryptionAvailable: () => false,
            encryptString: () => Buffer.alloc(0),
            decryptString: () => '',
        },
    });

    await assert.rejects(storage.write('key', 'plaintext'), /unavailable/i);
});

test('Linux safeStorage basic_text fallback is rejected as unprotected', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'happier-desktop-secure-storage-'));
    const storage = new ElectronSecureStorage({
        userDataPath: () => userData,
        crypto: {
            isEncryptionAvailable: () => true,
            getSelectedStorageBackend: () => 'basic_text',
            encryptString: () => Buffer.alloc(0),
            decryptString: () => '',
        },
    });

    await assert.rejects(storage.write('key', 'plaintext'), /no protected OS credential backend/i);
});
