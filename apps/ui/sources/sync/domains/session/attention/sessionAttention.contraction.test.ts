import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';

/**
 * Lane 09B contraction guard: direct-session personal attention is owned by
 * `resolveSessionPersonalAttentionForViewer` (Protocol `resolveSessionPersonalAttentionV1`),
 * not by a hydrated-row scan. `sessionAttention.ts` must remain a type-only
 * filter-options owner for Activity; it must not decide current attention.
 */
describe('sessionAttention contraction', () => {
    it('exposes no runtime attention decision', async () => {
        const module = await import('./sessionAttention');
        expect('deriveSessionAttentionFlags' in module).toBe(false);
        expect('hasSessionAttention' in module).toBe(false);
        expect('deriveSessionAttentionState' in module).toBe(false);
    });

    it('does not retain the replaced attention-state owner as a dormant source module', async () => {
        const filenames = await readdir(new URL('.', import.meta.url));
        expect(filenames).not.toContain('deriveSessionAttentionState.ts');
        expect(filenames).not.toContain('deriveSessionAttentionState.test.ts');
    });
});
