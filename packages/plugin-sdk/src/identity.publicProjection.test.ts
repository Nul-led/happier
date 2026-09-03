import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
    computeCanonicalDomainSeparatedDigest as canonicalComputeCanonicalDomainSeparatedDigest,
} from '@happier-dev/protocol/crypto/canonicalDigest';
import {
    createCanonicalJsonSigningInput as canonicalCreateCanonicalJsonSigningInput,
} from '@happier-dev/protocol/crypto/canonicalJson';

import {
    computeCanonicalDomainSeparatedDigest,
    createCanonicalJsonSigningInput,
} from './identity.js';

describe('identity public projection', () => {
    it('preserves the canonical digest identity through the root author spec', () => {
        const rootAuthorSource = readFileSync(
            new URL('./index.public.ts', import.meta.url),
            'utf8',
        );

        expect(computeCanonicalDomainSeparatedDigest).toBe(
            canonicalComputeCanonicalDomainSeparatedDigest,
        );
        expect(rootAuthorSource).toContain(
            "export { computeCanonicalDomainSeparatedDigest } from './identity.js';",
        );
    });

    it('publishes Protocol as the one canonical JSON signing-input owner', () => {
        const rootAuthorSource = readFileSync(
            new URL('./index.public.ts', import.meta.url),
            'utf8',
        );

        expect(createCanonicalJsonSigningInput).toBe(canonicalCreateCanonicalJsonSigningInput);
        expect(rootAuthorSource).toContain(
            "export { createCanonicalJsonSigningInput } from './identity.js';",
        );
        // A plugin producer and verifier of the same digest reach the same
        // bytes regardless of the property order their value arrived in.
        expect(createCanonicalJsonSigningInput({ b: 1, a: { d: 2, c: 3 } })).toBe(
            createCanonicalJsonSigningInput({ a: { c: 3, d: 2 }, b: 1 }),
        );
        expect(() => createCanonicalJsonSigningInput(undefined as never)).toThrow();
        expect(() => createCanonicalJsonSigningInput({ invalid: undefined } as never)).toThrow();
        expect(() => createCanonicalJsonSigningInput({ invalid: () => undefined } as never)).toThrow();
        expect(() => createCanonicalJsonSigningInput(Symbol('invalid') as never)).toThrow();
        expect(() => createCanonicalJsonSigningInput(1n as never)).toThrow();
    });
});
