import { describe, expect, it } from 'vitest';

import type { HomeGovernanceEligibilityV1 } from '@happier-dev/protocol/home/governance';

import { resolveTeamsCreateGuidance, type TeamsCreateAnswer } from './teamsCreateGuidance';

function answer(
    serverId: string,
    eligibility: Partial<HomeGovernanceEligibilityV1>,
): TeamsCreateAnswer {
    return {
        serverId,
        homeName: `Home ${serverId}`,
        eligibility: {
            teamsEnabled: true,
            createTeam: false,
            createTeamForChosenAccount: false,
            ...eligibility,
        },
    };
}

describe('resolveTeamsCreateGuidance', () => {
    it('names the administrators of the one Home in view when it administers Team creation', () => {
        expect(resolveTeamsCreateGuidance({
            homesInView: 1,
            answers: [answer('a', { teamCreationPolicy: 'managed_only', administratorNames: ['Ada', 'Grace'] })],
        })).toEqual({
            refusal: { kind: 'administered', administratorNames: ['Ada', 'Grace'] },
            openCreationPolicyServerId: null,
        });
    });

    it('says creation is off, without anyone to ask, when the one Home in view disabled it', () => {
        expect(resolveTeamsCreateGuidance({
            homesInView: 1,
            answers: [answer('a', { teamCreationPolicy: 'disabled', administratorNames: ['Ada'] })],
        }).refusal).toEqual({ kind: 'off' });
    });

    it('names the refusing Homes when the Home predates the policy class or several Homes are in view', () => {
        // An older Home answers only its three effective facts.
        expect(resolveTeamsCreateGuidance({ homesInView: 1, answers: [answer('a', {})] }).refusal)
            .toEqual({ kind: 'denied', homeNames: ['Home a'] });
        expect(resolveTeamsCreateGuidance({
            homesInView: 2,
            answers: [
                answer('a', { teamCreationPolicy: 'managed_only', administratorNames: ['Ada'] }),
                answer('b', { teamCreationPolicy: 'disabled' }),
            ],
        }).refusal).toEqual({ kind: 'denied', homeNames: ['Home a', 'Home b'] });
    });

    it('explains nothing while any Home in view offers creation or none has answered', () => {
        expect(resolveTeamsCreateGuidance({
            homesInView: 2,
            answers: [answer('a', { teamCreationPolicy: 'managed_only' }), answer('b', { createTeam: true })],
        }).refusal).toBeNull();
        expect(resolveTeamsCreateGuidance({ homesInView: 1, answers: [] }).refusal).toBeNull();
    });

    it('points an administrator of managed creation to the policy that lets everyone create', () => {
        expect(resolveTeamsCreateGuidance({
            homesInView: 1,
            answers: [answer('a', { createTeam: true, createTeamForChosenAccount: true, teamCreationPolicy: 'managed_only' })],
        })).toEqual({ refusal: null, openCreationPolicyServerId: 'a' });
        // Under self-service there is nothing to open up.
        expect(resolveTeamsCreateGuidance({
            homesInView: 1,
            answers: [answer('a', { createTeam: true, teamCreationPolicy: 'self_service' })],
        }).openCreationPolicyServerId).toBeNull();
        // Two such Homes would make the link ambiguous.
        expect(resolveTeamsCreateGuidance({
            homesInView: 2,
            answers: [
                answer('a', { createTeam: true, createTeamForChosenAccount: true }),
                answer('b', { createTeam: true, createTeamForChosenAccount: true }),
            ],
        }).openCreationPolicyServerId).toBeNull();
    });
});
