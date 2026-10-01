import { describe, expect, it } from 'vitest';
import { ComposerOptionsInputV1Schema, EmbedSessionOptionsV1Schema, projectComposerOptionsInputV1 } from './embedSessionOptionsV1.js';

describe('bounded composer options projection', () => {
    it('retains existing alias inputs without exporting the complete owner view', () => {
        const override = { v: 1, updatedAt: 10, overrides: { thinking: { value: true, updatedAt: 10 } } };
        const owner = projectComposerOptionsInputV1({
            path: '/private', machineId: 'private-machine', connectedServices: { secret: true },
            sessionConfigOptionOverridesV1: override, acpConfigOptionOverridesV1: override,
            modelOverrideV1: { v: 1, updatedAt: 10, modelId: 'chosen' },
        });
        expect(owner).toEqual({ sessionConfigOptionOverridesV1: override, acpConfigOptionOverridesV1: override,
            modelOverrideV1: { v: 1, updatedAt: 10, modelId: 'chosen' } });
        expect(ComposerOptionsInputV1Schema.safeParse({ ...owner, path: '/leak' }).success).toBe(false);
        expect(EmbedSessionOptionsV1Schema.safeParse({ v: 1, sessionId: 's', owner }).success).toBe(true);
        expect(EmbedSessionOptionsV1Schema.safeParse({ v: 1, sessionId: 's', owner, handoff: {} }).success).toBe(false);
    });
});
