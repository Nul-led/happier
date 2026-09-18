import { describe, expect, it } from 'vitest';

import { projectSessionAccessContextChange } from './projectSessionAccessContextChange';

const restricted = (teamId: string) => ({
    teamId,
    name: teamId,
    sessionCreationPolicy: 'private_default' as const,
    externalSharingPolicy: 'disabled' as const,
});

describe('projectSessionAccessContextChange', () => {
    it('reviews restrictive audience reclassification between Teams with the same policy', () => {
        const consequences = projectSessionAccessContextChange({
            current: restricted('team-one'),
            target: restricted('team-two'),
            grants: [],
        });

        expect(consequences).toHaveLength(1);
        expect(consequences[0]).toMatch(/external sharing/i);
    });

    it('names the required floor only when the target grant needs adding or promotion', () => {
        const target = {
            ...restricted('team-two'),
            sessionCreationPolicy: 'team_required' as const,
            externalSharingPolicy: 'allowed' as const,
        };

        expect(projectSessionAccessContextChange({ current: null, target, grants: [] }))
            .toEqual([expect.stringMatching(/required/i)]);
        expect(projectSessionAccessContextChange({
            current: null,
            target,
            grants: [{ subject: { kind: 'team', teamId: target.teamId }, accessLevel: 'edit' }],
        })).toEqual([]);
    });
});
