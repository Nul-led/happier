import { beforeEach, describe, expect, it } from 'vitest';

import { encodeBase64 } from '@/encryption/base64';

import { Encryption } from './encryption';
import { createFakeCryptoWorker } from './nativeCryptoWorker/fakeCryptoWorker';
import { resetNativeCryptoWorkerCapabilityCacheForTests } from './nativeCryptoWorker/nativeCryptoWorkerRouting';
import { resetNativeCryptoWorkerQueueLifecycleForTests } from './nativeCryptoWorker/nativeCryptoWorkerQueue';
import { resetDefaultNativeCryptoWorkerRoutingForTests } from './nativeCryptoWorker/nativeCryptoWorkerRoutingConfig';
import type {
    CryptoWorkerBatchRequest,
    NativeCryptoWorker,
    NativeCryptoWorkerDataKeyEnvelopeItem,
} from './nativeCryptoWorker/types';

/**
 * Wraps the canonical fake worker and replaces one opened item with a
 * cryptographically plausible but wrong-sized result, which is what a broken or
 * outdated native module would hand back across the bridge.
 */
function createWrongSizedResultWorker(replacements: ReadonlyMap<number, Uint8Array>): NativeCryptoWorker {
    const inner = createFakeCryptoWorker();
    return {
        probe: () => inner.probe(),
        decryptDataKeyEnvelopeV1: async (request: CryptoWorkerBatchRequest<NativeCryptoWorkerDataKeyEnvelopeItem>) => {
            const result = await inner.decryptDataKeyEnvelopeV1(request);
            return {
                ...result,
                items: result.items.map((item, index) => {
                    const replacement = replacements.get(index);
                    return replacement ? encodeBase64(replacement, 'base64') : item;
                }),
            };
        },
        decryptSecretboxJson: (request) => inner.decryptSecretboxJson(request),
        decryptAesGcmJson: (request) => inner.decryptAesGcmJson(request),
    };
}

async function sealDataKeys(encryption: Encryption, dataKeys: readonly Uint8Array[]): Promise<string[]> {
    const envelopes: string[] = [];
    for (const dataKey of dataKeys) {
        envelopes.push(encodeBase64(await encryption.encryptEncryptionKey(dataKey), 'base64'));
    }
    return envelopes;
}

describe('Encryption fixed data-key envelope contract', () => {
    beforeEach(() => {
        resetDefaultNativeCryptoWorkerRoutingForTests();
        resetNativeCryptoWorkerCapabilityCacheForTests();
        resetNativeCryptoWorkerQueueLifecycleForTests();
    });

    it('rejects a native result that is not exactly one data key without losing the valid items', async () => {
        const encryption = await Encryption.create(new Uint8Array(32).fill(11));
        encryption.configureNativeCryptoWorker({
            worker: createWrongSizedResultWorker(new Map([
                [0, new Uint8Array(31).fill(5)],
                [2, new Uint8Array(33).fill(6)],
            ])),
        });

        const dataKeys = [
            new Uint8Array(32).fill(21),
            new Uint8Array(32).fill(22),
            new Uint8Array(32).fill(23),
        ];
        const envelopes = await sealDataKeys(encryption, dataKeys);

        expect(await encryption.decryptEncryptionKeys(envelopes)).toEqual([null, dataKeys[1], null]);
    });

    it('refuses to seal an envelope around a key that is not exactly 32 bytes', async () => {
        const encryption = await Encryption.create(new Uint8Array(32).fill(12));

        await expect(encryption.encryptEncryptionKey(new Uint8Array(31).fill(7))).rejects.toThrow(/data key length/i);
        await expect(encryption.encryptEncryptionKey(new Uint8Array(33).fill(8))).rejects.toThrow(/data key length/i);
    });
});
