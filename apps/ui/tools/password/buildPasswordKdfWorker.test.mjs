import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { buildPasswordKdfWorker } from './buildPasswordKdfWorker.mjs';

test('emitted password worker executes without Node or external script loading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-password-worker-'));
    try {
        const { outputFile } = await buildPasswordKdfWorker({
            outputFile: join(directory, 'happier-password-kdf-worker.js'),
        });
        const replies = [];
        // Genuine worker globals only: no require, process, fetch or importScripts.
        const context = {
            crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
            postMessage: (message) => replies.push(structuredClone(message)),
        };
        context.self = context;
        runInNewContext(await readFile(outputFile, 'utf8'), context);
        await context.onmessage({ data: {
            password: new TextEncoder().encode('a sufficiently long password'),
            kdf: {
                algorithm: 'argon2id13', salt: 'AAAAAAAAAAAAAAAAAAAAAA',
                opsLimit: 2, memLimitBytes: 67108864, outputBytes: 32,
            },
        } });
        assert.equal(replies.length, 1);
        assert.equal(replies[0].ok, true);
        assert.equal(replies[0].key.byteLength, 32);
        assert.ok(replies[0].key.some((byte) => byte !== 0));
        await context.onmessage({ data: {} });
        assert.equal(replies[1].ok, false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
