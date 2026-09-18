import { describe, expect, it } from 'vitest';

import { resolveTemporaryComputerAgentCompatibility } from './temporaryComputerAgentCompatibility';

describe('resolveTemporaryComputerAgentCompatibility', () => {
    it('requires catalog, canonical Agent target, and the exact creator readiness producer', () => {
        expect(resolveTemporaryComputerAgentCompatibility({
            catalogEntryPresent: true,
            canonicalAgentTargetPresent: true,
            creatorReadinessProducerPresent: false,
        })).toBe(false);
        expect(resolveTemporaryComputerAgentCompatibility({
            catalogEntryPresent: true,
            canonicalAgentTargetPresent: false,
            creatorReadinessProducerPresent: true,
        })).toBe(false);
        expect(resolveTemporaryComputerAgentCompatibility({
            catalogEntryPresent: false,
            canonicalAgentTargetPresent: true,
            creatorReadinessProducerPresent: true,
        })).toBe(false);
        expect(resolveTemporaryComputerAgentCompatibility({
            catalogEntryPresent: true,
            canonicalAgentTargetPresent: true,
            creatorReadinessProducerPresent: true,
        })).toBe(true);
    });
});
