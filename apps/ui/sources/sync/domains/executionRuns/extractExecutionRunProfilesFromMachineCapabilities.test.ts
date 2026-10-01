import { describe, expect, it } from 'vitest';

import { extractExecutionRunProfilesFromMachineCapabilitiesState } from './extractExecutionRunsBackendsFromMachineCapabilities';

describe('extractExecutionRunProfilesFromMachineCapabilitiesState', () => {
    it('accepts only qualified profiles with canonical source custody', () => {
        const profiles = extractExecutionRunProfilesFromMachineCapabilitiesState({
            snapshot: { response: { results: { 'tool.executionRuns': { ok: true, data: {
                executionRunProfiles: [
                    {
                        id: 'review.coderabbit/review',
                        intent: 'review',
                        title: { key: 'profile.review', fallback: 'CodeRabbit Review' },
                        compatibleAgents: ['coderabbit'],
                        sourceCustody: { kind: 'managed', immutableGenerationId: 'generation-3', installSource: 'archive' },
                        available: true,
                        defaults: { retention: 'resumable', runClass: 'bounded', io: 'streaming' },
                    },
                    { id: 'local-only', intent: 'review', sourceCustody: { kind: 'managed', immutableGenerationId: 'generation-3', installSource: 'archive' } },
                    { id: 'review.deepsec/audit', intent: 'review' },
                ],
            } } } } },
        });

        expect(profiles).toEqual([{
            id: 'review.coderabbit/review',
            intent: 'review',
            title: 'CodeRabbit Review',
            compatibleAgentIds: ['coderabbit'],
            sourceCustody: { kind: 'managed', immutableGenerationId: 'generation-3', installSource: 'archive' },
            available: true,
            defaults: { retention: 'resumable', runClass: 'bounded', io: 'streaming' },
        }]);
    });
});
