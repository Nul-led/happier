import { describe, expect, it } from 'vitest';

import { deriveAccountSigningPublicKey } from '@/auth/flows/challenge';
import { encodeBase64 } from '@/encryption/base64';
import { resolveExpectedRunnerMachineContentKeyBindingV1 } from './runnerMachineContentKeyTrust';

describe('resolveExpectedRunnerMachineContentKeyBindingV1', () => {
    it('derives the trusted signer from canonical base64url legacy credentials', () => {
        // This seed deliberately encodes with "_" characters. Decoding it as
        // padded base64 would discard those bytes and either reject the
        // credential or derive a different signing identity.
        const seed = new Uint8Array(32).fill(0xff);

        expect(resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: {
                token: 'e30.eyJzdWIiOiJhY2NvdW50LW9uZSJ9.signature',
                secret: encodeBase64(seed, 'base64url'),
            },
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        })).toEqual({
            homeServerIdentityId: 'home-one',
            creatorAccountId: 'account-one',
            machineId: 'machine-one',
            accountSigningPublicKeyBase64Url: encodeBase64(
                deriveAccountSigningPublicKey(seed),
                'base64url',
            ),
        });
    });
});
