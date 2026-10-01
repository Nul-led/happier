import type { HomeGovernanceEligibilityV1 } from '@happier-dev/protocol/home/governance';

/** One Home's current eligibility answer, for a Home in view that offers Teams. */
export type TeamsCreateAnswer = Readonly<{
    serverId: string;
    homeName: string;
    eligibility: HomeGovernanceEligibilityV1;
}>;

/**
 * Why nobody in view can create a Team from here, and who can.
 *
 * - `administered`: the one Home in view has its administrators create Teams; they are named.
 * - `off`: the one Home in view turned Team creation off.
 * - `denied`: the Homes that refuse, named, when the Home predates the policy class or several
 *   Homes are in view.
 */
export type TeamsCreateRefusal =
    | Readonly<{ kind: 'administered'; administratorNames: readonly string[] }>
    | Readonly<{ kind: 'off' }>
    | Readonly<{ kind: 'denied'; homeNames: readonly string[] }>;

export type TeamsCreateGuidance = Readonly<{
    /** `null` while a Home in view offers creation, or before any Home has answered. */
    refusal: TeamsCreateRefusal | null;
    /**
     * The Home whose administrator (this viewer) creates Teams for others and could let everyone
     * create them instead. `null` unless exactly one Home in view is in that state.
     */
    openCreationPolicyServerId: string | null;
}>;

/**
 * The Teams page's create guidance, from the current answers of the Homes in view.
 *
 * The page never shows a create action that cannot succeed; when none can, it says who creates Teams
 * instead of leaving a dead end. Only a single Home in view is described by its policy and
 * administrators, because one sentence cannot name the administrators of several Homes.
 */
export function resolveTeamsCreateGuidance(input: Readonly<{
    homesInView: number;
    answers: readonly TeamsCreateAnswer[];
}>): TeamsCreateGuidance {
    const managers = input.answers.filter((answer) => answer.eligibility.createTeamForChosenAccount);
    const openCreationPolicyServerId = managers.length === 1 ? managers[0]!.serverId : null;
    if (input.answers.length === 0 || input.answers.some((answer) => answer.eligibility.createTeam)) {
        return { refusal: null, openCreationPolicyServerId };
    }

    const only = input.homesInView === 1 && input.answers.length === 1 ? input.answers[0]! : null;
    if (only?.eligibility.teamCreationPolicy === 'managed_only') {
        return {
            refusal: { kind: 'administered', administratorNames: only.eligibility.administratorNames ?? [] },
            openCreationPolicyServerId,
        };
    }
    if (only?.eligibility.teamCreationPolicy === 'disabled') {
        return { refusal: { kind: 'off' }, openCreationPolicyServerId };
    }
    return {
        refusal: { kind: 'denied', homeNames: input.answers.map((answer) => answer.homeName) },
        openCreationPolicyServerId,
    };
}
