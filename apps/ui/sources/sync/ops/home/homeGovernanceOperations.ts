import {
    HomeAccountDeleteResultV1Schema,
    HomeAccountListResultV1Schema,
    HomeAccountSearchResultV1Schema,
    type HomeAccountListResultV1,
    type HomeAccountSearchResultV1,
    type HomeAuthenticationPolicyV1,
    type HomeGovernanceActionIdV1,
    type HomeIdentityNetworkPolicyV1,
    type HomeRoleV1,
    type HomeTeamProviderPolicyV1,
    type TeamCreationPolicyV1,
} from '@happier-dev/protocol/home/governance';

import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { refreshHomeGovernanceSnapshot } from '@/sync/engine/home/governance/homeGovernanceEngine';
import { scopedHomeActionExecutor } from '@/sync/ops/actions/scopedHomeActionExecutor';
import { classifyHomeActionOutcome, type HomeActionOutcome } from './homeActionOutcome';

export { classifyHomeActionOutcome as classifyHomeGovernanceActionOutcome } from './homeActionOutcome';

/**
 * Home-governance intents, addressed to one explicit Home.
 *
 * Every one of them is an Action, executed by the one shared Action executor.
 * That executor owns admission, the Action settings policy, approval and output
 * validation, and this module owns none of those: the Home family dependency it
 * is given knows only which Home the intent belongs to, and the canonical row
 * for the id supplies the method, path and result schema. There is no local
 * route table and no permissive acknowledgement shape here any more.
 *
 * What remains genuinely local is the part a surface should not repeat: a
 * refresh of the same Home after a change the Home actually accepted, a result
 * union that keeps an incomplete erasure distinguishable from a completed one,
 * and the Home's own typed refusal carried through untouched so the surface can
 * explain the real reason. Confirmation stays with the surface, where the person
 * is; nothing here decides whether an action was intended.
 */

export type HomeGovernanceMutationOutcome =
    | Readonly<{ kind: 'succeeded' }>
    /** The shared Action owner accepted the request for later approval, but has not mutated the Home. */
    | Readonly<{ kind: 'approval_pending'; artifactId: string }>
    /**
     * Access was revoked but cleanup did not finish. This is never rendered as
     * success: the Account is now Retired and the deletion remains to be
     * completed by an authorized owner.
     */
    | Readonly<{ kind: 'incomplete' }>
    | Readonly<{ kind: 'failed'; failure: HomeDomainFailure }>;

/**
 * The result of a mutation whose answer settles it either way.
 *
 * Erasure is the only Home intent that can leave work half-done, so it is the
 * only one whose result can be `incomplete`. Saying so in the type is what lets
 * every other surface narrow to the Home's actual refusal without defending
 * itself against a state its intent cannot produce.
 */
export type HomeGovernanceAcknowledgedOutcome =
    Exclude<HomeGovernanceMutationOutcome, Readonly<{ kind: 'incomplete' }>>;

export type HomeGovernanceQueryOutcome<TValue> =
    | Readonly<{ kind: 'succeeded'; value: TValue }>
    | Readonly<{ kind: 'failed'; failure: HomeDomainFailure }>;

const SUCCEEDED: HomeGovernanceAcknowledgedOutcome = Object.freeze({ kind: 'succeeded' as const });
const INCOMPLETE: HomeGovernanceMutationOutcome = Object.freeze({ kind: 'incomplete' as const });

/**
 * Runs one Home intent through the shared executor.
 *
 * The executor is built per call with this Home's family dependency: the scope
 * is captured before anything is awaited, so focusing another Home while the
 * intent is in flight cannot retarget it or publish its result under the wrong
 * Home.
 */
async function executeHomeAction(params: Readonly<{
    scope: ServerAccountScope;
    actionId: HomeGovernanceActionIdV1;
    input: unknown;
}>): Promise<HomeActionOutcome> {
    const result = await scopedHomeActionExecutor(params.scope)(params.actionId, params.input, {
        surface: 'ui',
        authority: 'present_user',
        serverId: params.scope.serverId,
    });
    return classifyHomeActionOutcome(result);
}

/**
 * An acknowledgement-only mutation. The Action row owns what a valid answer
 * looks like, so reaching here at all means the Home accepted the change.
 */
async function mutate(params: Readonly<{
    scope: ServerAccountScope;
    actionId: HomeGovernanceActionIdV1;
    input: unknown;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    const outcome = await executeHomeAction(params);
    if (outcome.kind === 'failed') {
        return Object.freeze({ kind: 'failed' as const, failure: outcome.failure });
    }
    if (outcome.kind === 'approval_pending') return outcome;
    // Only an accepted change can have moved this Home. Refreshing after a
    // refusal would spend a request to observe state that did not change.
    await refreshHomeGovernanceSnapshot(params.scope);
    return SUCCEEDED;
}

export function setHomeAccountRole(params: Readonly<{
    scope: ServerAccountScope;
    accountId: string;
    homeRole: HomeRoleV1;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    return mutate({
        scope: params.scope,
        actionId: 'home.accounts.role.set',
        input: { accountId: params.accountId, homeRole: params.homeRole },
    });
}

/** The reversible hold. Presented to administrators as **Disable**. */
export function disableHomeAccount(params: Readonly<{
    scope: ServerAccountScope;
    accountId: string;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    return mutate({
        scope: params.scope,
        actionId: 'home.accounts.disable',
        input: { accountId: params.accountId },
    });
}

export function enableHomeAccount(params: Readonly<{
    scope: ServerAccountScope;
    accountId: string;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    return mutate({
        scope: params.scope,
        actionId: 'home.accounts.enable',
        input: { accountId: params.accountId },
    });
}

/**
 * Deletes one Account and its data through the Home's single erasure owner.
 *
 * An authorized owner may call this again for an Account already left Retired by
 * a failed attempt; that is a fresh authorized request to finish the deletion,
 * not a resurrection of partially erased data.
 */
export async function deleteHomeAccount(params: Readonly<{
    scope: ServerAccountScope;
    accountId: string;
}>): Promise<HomeGovernanceMutationOutcome> {
    const outcome = await executeHomeAction({
        scope: params.scope,
        actionId: 'home.accounts.delete',
        input: { accountId: params.accountId },
    });
    if (outcome.kind === 'failed') {
        return Object.freeze({ kind: 'failed' as const, failure: outcome.failure });
    }
    if (outcome.kind === 'approval_pending') return outcome;

    const parsed = HomeAccountDeleteResultV1Schema.safeParse(outcome.result);
    // Either answer means this Account's access is gone, so the Home moved.
    await refreshHomeGovernanceSnapshot(params.scope);
    if (!parsed.success) {
        // An answer this surface cannot read is never reported as a completed
        // deletion; incomplete is the only safe reading.
        return INCOMPLETE;
    }
    return parsed.data.status === 'deleted' ? SUCCEEDED : INCOMPLETE;
}

export function setHomeTeamCreationPolicy(params: Readonly<{
    scope: ServerAccountScope;
    expectedRevision: number;
    teamCreationPolicy: TeamCreationPolicyV1;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    return mutate({
        scope: params.scope,
        actionId: 'home.policy.set',
        input: {
            expectedRevision: params.expectedRevision,
            teamCreationPolicy: params.teamCreationPolicy,
        },
    });
}

/**
 * Applies the authentication-related fields of the Home's one policy document.
 * Callers still receive the same compare-and-set conflict and refresh behavior
 * as Team creation; this is a typed surface over that owner, not another writer.
 */
export function setHomeAuthenticationPolicies(params: Readonly<{
    scope: ServerAccountScope;
    expectedRevision: number;
    authenticationPolicy?: HomeAuthenticationPolicyV1 | null;
    teamProviderPolicy?: HomeTeamProviderPolicyV1 | null;
    identityNetworkPolicy?: HomeIdentityNetworkPolicyV1 | null;
}>): Promise<HomeGovernanceAcknowledgedOutcome> {
    return mutate({
        scope: params.scope,
        actionId: 'home.policy.set',
        input: {
            expectedRevision: params.expectedRevision,
            ...(params.authenticationPolicy !== undefined
                ? { authenticationPolicy: params.authenticationPolicy }
                : {}),
            ...(params.teamProviderPolicy !== undefined
                ? { teamProviderPolicy: params.teamProviderPolicy }
                : {}),
            ...(params.identityNetworkPolicy !== undefined
                ? { identityNetworkPolicy: params.identityNetworkPolicy }
                : {}),
        },
    });
}

/** Reads a typed answer whose shape the surface depends on. */
async function query<TValue>(params: Readonly<{
    scope: ServerAccountScope;
    actionId: HomeGovernanceActionIdV1;
    input: unknown;
    parse: (value: unknown) => { success: true; data: TValue } | { success: false };
}>): Promise<HomeGovernanceQueryOutcome<TValue>> {
    const outcome = await executeHomeAction(params);
    if (outcome.kind === 'failed') {
        return Object.freeze({ kind: 'failed' as const, failure: outcome.failure });
    }
    if (outcome.kind === 'approval_pending') {
        return Object.freeze({
            kind: 'failed' as const,
            failure: Object.freeze({
                kind: 'conflict' as const,
                retryable: false,
                code: null,
            }),
        });
    }
    const parsed = params.parse(outcome.result);
    if (!parsed.success) {
        return Object.freeze({
            kind: 'failed' as const,
            failure: Object.freeze({ kind: 'invalid' as const, retryable: false, code: null }),
        });
    }
    return Object.freeze({ kind: 'succeeded' as const, value: parsed.data });
}

/**
 * Reads one page of the Home's People list.
 *
 * This is a read, so it never refreshes the governance projection: the two
 * answer different questions and a list page moving does not mean the viewer's
 * own capabilities did.
 */
export function listHomeAccounts(params: Readonly<{
    scope: ServerAccountScope;
    cursor?: string | null;
    limit?: number;
}>): Promise<HomeGovernanceQueryOutcome<HomeAccountListResultV1>> {
    return query({
        scope: params.scope,
        actionId: 'home.accounts.list',
        input: {
            ...(params.cursor ? { cursor: params.cursor } : {}),
            ...(params.limit ? { limit: params.limit } : {}),
        },
        parse: (value) => HomeAccountListResultV1Schema.safeParse(value),
    });
}

/**
 * Looks up people on one Home by name.
 *
 * The scope is always stated explicitly rather than inferred from what the
 * caller happens to be administering: Home scope is authorized by Home account
 * management, and a Team scope would be authorized by that exact Team. The
 * result is the minimal picker row, so this is a way to find a person — not a
 * second, thinner view of the People list.
 */
export function searchHomeAccounts(params: Readonly<{
    scope: ServerAccountScope;
    query: string;
}>): Promise<HomeGovernanceQueryOutcome<HomeAccountSearchResultV1>> {
    return query({
        scope: params.scope,
        actionId: 'home.accounts.search',
        input: { query: params.query.trim(), scope: { kind: 'home' } },
        parse: (value) => HomeAccountSearchResultV1Schema.safeParse(value),
    });
}
