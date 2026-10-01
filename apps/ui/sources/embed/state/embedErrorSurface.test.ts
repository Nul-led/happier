import { describe, expect, it } from 'vitest';
import { EmbedErrorCodeV1Schema } from '@happier-dev/protocol/embed';

import { resolveEmbedErrorSurface } from './embedErrorSurface';

describe('embed error surfaces', () => {
    it('gives every refusal a designed state, keeping the code for Details only', () => {
        for (const code of EmbedErrorCodeV1Schema.options) {
            const surface = resolveEmbedErrorSurface(code);
            if (code === 'credential_unavailable') {
                // The last transcript stays with a reconnecting banner; there is no full-frame state.
                expect(surface).toBeNull();
                continue;
            }
            expect(surface?.diagnosticCode).toBe(code);
        }
    });

    it('says the same thing for refusals the viewer cannot tell apart', () => {
        const rejected = resolveEmbedErrorSurface('credential_rejected');
        expect(resolveEmbedErrorSurface('session_not_found')?.titleKey).toBe(rejected?.titleKey);

        const encrypted = resolveEmbedErrorSurface('session_key_unavailable');
        expect(resolveEmbedErrorSurface('session_key_invalid')?.titleKey).toBe(encrypted?.titleKey);
        expect(resolveEmbedErrorSurface('session_key_not_transferable')?.titleKey).toBe(encrypted?.titleKey);
        expect(encrypted?.titleKey).not.toBe(rejected?.titleKey);
        expect(resolveEmbedErrorSurface('origin_not_allowed')?.titleKey).not.toBe(rejected?.titleKey);
    });
});
