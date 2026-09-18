import { expect, it, vi } from 'vitest';
import { preparePasswordCredentialMaterialV1 } from './preparePasswordCredential';
import { recoverPasswordEnvelopeSecret } from './recoverPasswordEnvelopeSecret';

// The memory-hard KDF runs in a platform worker, which is a genuine system
// boundary unavailable in Vitest. Keep the envelope/auth-key path real while
// supplying the same deterministic worker stand-in to both writer and reader.
vi.mock('./derivePasswordEnvelopeKey', () => ({
    derivePasswordEnvelopeKey: async (input: {
        password: string;
        kdf: { salt: string; opsLimit: number; memLimitBytes: number };
    }) => {
        const seed = new TextEncoder().encode(
            `${input.password}|${input.kdf.salt}|${input.kdf.opsLimit}|${input.kdf.memLimitBytes}`,
        );
        const root = new Uint8Array(32);
        for (let index = 0; index < seed.length; index += 1) {
            root[index % 32] = (root[index % 32]! * 31 + seed[index]! + index) & 0xff;
        }
        return root;
    },
}));

const issuedChallenge = {
    challengeId: 'password-recovery-challenge',
    nonce: 'password-recovery-nonce',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    audience: { origin: 'https://home.example.test', serverIdentityId: 'srv_home' },
} as const;

it('opens the existing E2EE password envelope locally and never sends password text', async () => {
    const secret = new Uint8Array(32).fill(19);
    const prepared = await preparePasswordCredentialMaterialV1({
        password: 'correct horse battery staple',
        secret,
    });
    const bodies: string[] = [];
    const request = async (path: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        if (path.endsWith('/prelogin')) {
            return Response.json({ v: 1, kind: 'e2ee_password_unlock', kdf: prepared.envelope.kdf });
        }
        return Response.json({
            envelope: prepared.envelope,
            expectedAccountId: 'account-a',
            challenge: issuedChallenge,
        });
    };

    const recovered = await recoverPasswordEnvelopeSecret({
        request,
        email: 'person@example.test',
        password: 'correct horse battery staple',
    });

    expect(recovered).toEqual(secret);
    expect(bodies.join('\n')).not.toContain('correct horse battery staple');
    recovered.fill(0);
});

it('rejects a wrong password without returning secret material', async () => {
    const secret = new Uint8Array(32).fill(23);
    const prepared = await preparePasswordCredentialMaterialV1({ password: 'right password value', secret });
    const request = async (path: string) => path.endsWith('/prelogin')
        ? Response.json({ v: 1, kind: 'e2ee_password_unlock', kdf: prepared.envelope.kdf })
        : Response.json({
            envelope: prepared.envelope,
            expectedAccountId: 'account-a',
            challenge: issuedChallenge,
        });

    await expect(recoverPasswordEnvelopeSecret({
        request,
        email: 'person@example.test',
        password: 'wrong password value',
    })).rejects.toThrow('password_authentication_failed');
});
