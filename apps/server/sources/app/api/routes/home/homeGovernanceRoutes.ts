import {
    HomeAccountDeleteResultV1Schema,
    HomeAccountListInputV1Schema,
    HomeAccountListResultV1Schema,
    HomeAccountRoleSetInputV1Schema,
    HomeAccountRowV1Schema,
    HomeAccountSearchInputV1Schema,
    HomeAccountSearchResultV1Schema,
    HomeAccountTargetInputV1Schema,
    HomeGovernanceErrorV1Schema,
    HomeGovernanceEligibilityGetInputV1Schema,
    HomeGovernanceEligibilityV1Schema,
    HomeGovernanceGetInputV1Schema,
    HomeGovernancePolicyProjectionV1Schema,
    HomeGovernancePolicySetInputV1Schema,
    HomeGovernanceProjectionV1Schema,
    homeGovernanceErrorHttpStatusV1,
    type AccountStatusV1,
} from "@happier-dev/protocol";

import { homeDomainActionPathForMethod } from "@/app/api/routes/actions/homeDomainActionRoute";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { isServerFeatureEnabledForRequest } from "@/app/features/catalog/serverFeatureGate";
import { setAccountStatusInTx } from "@/app/home/governance/accountLifecycle";
import { setHomeGovernancePolicy } from "@/app/home/governance/governancePolicy";
import {
    listHomeAccountsInTx,
    projectHomeGovernancePolicyV1,
    readHomeAccountRowInTx,
    readHomeGovernanceEligibilityInTx,
    readHomeGovernanceProjectionInTx,
    searchHomeAccountsInTx,
    setHomeRoleInTx,
} from "@/app/home/governance/homeGovernanceService";
import { deleteAccountForErasure } from "@/app/plugins/data/accountDataErase";
import { readTeamOperationAuthenticationFromRequest } from "@/app/teams/actorContext";
import { inTx } from "@/storage/inTx";

import type { Fastify } from "../../types";
import { registerHomeManagedIdentityProviderRoutes } from "./homeManagedIdentityProviderRoutes";

const GOVERNANCE_RATE_LIMIT = { rateLimit: resolveApiHotEndpointRateLimit(process.env, "account.settings") };

const ERROR_RESPONSES = {
    400: HomeGovernanceErrorV1Schema,
    403: HomeGovernanceErrorV1Schema,
    404: HomeGovernanceErrorV1Schema,
    409: HomeGovernanceErrorV1Schema,
} as const;

/**
 * The Home Administration transport.
 *
 * Every route authenticates the actual principal and then delegates to the
 * governance owners, which reread actor and target inside the deciding
 * transaction. No route carries its own role ladder, and none rejects approved
 * automation with a blanket present-user prehandler: authority comes from
 * current `Account.homeRole` and lifecycle state, not from how the request was
 * produced.
 */
export function homeGovernanceRoutes(app: Fastify): void {
    registerHomeManagedIdentityProviderRoutes(app);
    // Keep the governance projection on the same resolved feature decision as
    // the Team route gate. Reading the raw env here would bypass build-policy
    // denies and dependency closure, allowing Home Administration to advertise
    // Team capability while every Team endpoint correctly returns 404.
    const teamsEnabled = (): boolean => isServerFeatureEnabledForRequest("teams", process.env);

    app.post(
        homeDomainActionPathForMethod('home.governance.get', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeGovernanceGetInputV1Schema,
                response: { 200: HomeGovernanceProjectionV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const projection = await inTx(async (tx) => await readHomeGovernanceProjectionInTx(tx, {
                viewerAccountId: request.userId,
                teamsEnabled: teamsEnabled(),
                env: process.env,
            }));
            if (projection.status === "rejected") {
                const status = projection.code === "home_governance_forbidden"
                    ? 403
                    : projection.code === "home_account_not_found"
                        ? 404
                        : 409;
                return await reply.code(status).send({ error: projection.code });
            }
            return await reply.send(projection.result);
        },
    );

    app.post(
        homeDomainActionPathForMethod('home.governance.eligibility.get', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeGovernanceEligibilityGetInputV1Schema,
                response: { 200: HomeGovernanceEligibilityV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const eligibility = await inTx(async (tx) => await readHomeGovernanceEligibilityInTx(tx, {
                viewerAccountId: request.userId,
                teamsEnabled: teamsEnabled(),
            }));
            if (!eligibility) return await reply
                .code(404)
                .send({ error: "home_account_not_found" as const });
            return await reply.send(eligibility);
        },
    );

    app.post(
        homeDomainActionPathForMethod('home.accounts.list', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeAccountListInputV1Schema,
                response: { 200: HomeAccountListResultV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const listing = await inTx(async (tx) => await listHomeAccountsInTx(tx, {
                actorAccountId: request.userId,
                env: process.env,
                ...(request.body.cursor !== undefined ? { cursor: request.body.cursor } : {}),
                ...(request.body.limit !== undefined ? { limit: request.body.limit } : {}),
            }));
            if (listing.status === "rejected") {
                return await reply.code(homeGovernanceErrorHttpStatusV1(listing.code)).send({ error: listing.code });
            }
            return await reply.send(listing.result);
        },
    );

    app.post(
        homeDomainActionPathForMethod('home.accounts.search', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeAccountSearchInputV1Schema,
                response: { 200: HomeAccountSearchResultV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const search = await inTx(async (tx) => await searchHomeAccountsInTx(tx, {
                actorAccountId: request.userId,
                query: request.body.query,
                scope: request.body.scope,
                teamsEnabled: teamsEnabled(),
                env: process.env,
                authentication: readTeamOperationAuthenticationFromRequest(request),
            }));
            if (search.status === "rejected") {
                return await reply.code(homeGovernanceErrorHttpStatusV1(search.code)).send({ error: search.code });
            }
            return await reply.send({ accounts: [...search.result] });
        },
    );

    app.post(
        homeDomainActionPathForMethod('home.accounts.role.set', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeAccountRoleSetInputV1Schema,
                response: { 200: HomeAccountRowV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const outcome = await inTx(async (tx) => await setHomeRoleInTx(tx, {
                actorAccountId: request.userId,
                targetAccountId: request.body.accountId,
                homeRole: request.body.homeRole,
                env: process.env,
            }), { isolationLevel: "Serializable" });
            if (outcome.status === "rejected") {
                return await reply.code(homeGovernanceErrorHttpStatusV1(outcome.code)).send({ error: outcome.code });
            }
            return await reply.send(outcome.result.account);
        },
    );

    /**
     * Disable and Re-enable are the same reversible lifecycle transition seen
     * from both directions, so they share one composition: the lifecycle owner
     * decides, and this route publishes the governance invalidation its
     * administrators need.
     */
    const registerLifecycleRoute = (path: string, status: AccountStatusV1): void => {
        app.post(
            path,
            {
                preHandler: [app.authenticate],
                attachValidation: true,
                schema: {
                    body: HomeAccountTargetInputV1Schema,
                    response: { 200: HomeAccountRowV1Schema, ...ERROR_RESPONSES },
                },
                config: GOVERNANCE_RATE_LIMIT,
            },
            async (request, reply) => {
                if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
                const outcome = await inTx(async (tx) => {
                    const transition = await setAccountStatusInTx(tx, {
                        actorAccountId: request.userId,
                        targetAccountId: request.body.accountId,
                        status,
                        authority: "home_administration",
                    });
                    if (transition.status === "rejected") return transition;
                    return {
                        status: "ok" as const,
                        account: await readHomeAccountRowInTx(tx, {
                            actorAccountId: request.userId,
                            accountId: request.body.accountId,
                        }),
                    };
                }, { isolationLevel: "Serializable" });
                if (outcome.status === "rejected") {
                    return await reply.code(homeGovernanceErrorHttpStatusV1(outcome.code)).send({ error: outcome.code });
                }
                if (!outcome.account) {
                    return await reply
                        .code(homeGovernanceErrorHttpStatusV1("home_account_not_found"))
                        .send({ error: "home_account_not_found" as const });
                }
                return await reply.send(outcome.account);
            },
        );
    };
    registerLifecycleRoute(homeDomainActionPathForMethod('home.accounts.disable', 'POST'), "suspended");
    registerLifecycleRoute(homeDomainActionPathForMethod('home.accounts.enable', 'POST'), "active");

    app.post(
        homeDomainActionPathForMethod('home.accounts.delete', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeAccountTargetInputV1Schema,
                response: { 200: HomeAccountDeleteResultV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            // The same physical erasure owner as present-user self-erasure. It
            // rereads this actor's `eraseAccounts` authority in both protected
            // transactions, so nothing here may shortcut that decision.
            const result = await deleteAccountForErasure({
                accountId: request.body.accountId,
                actor: { kind: "home_administration", actorAccountId: request.userId },
            });
            if (result.status === "deleted" || result.status === "already-deleted") {
                // A retry that finds the Account gone finished the job; the
                // authorized owner asked for exactly that outcome. Socket
                // disconnection already happened after the erasure's own
                // terminal-disable commit, so this route adds no second wake.
                return await reply.send({ status: "deleted" as const });
            }
            switch (result.code) {
                case "home_governance_forbidden":
                case "home_account_not_found":
                case "home_owner_transfer_required":
                // A live, staffed Team would lose its last owner. Like the Home
                // case this is refused before any irreversible work, so the
                // administrator transfers Team ownership and reissues.
                case "team_owner_transfer_required":
                    return await reply.code(homeGovernanceErrorHttpStatusV1(result.code)).send({ error: result.code });
                case "account_erasure_not_retired":
                    // The Account is active again, so it is not "disabled
                    // pending completion"; this erasure is simply no longer the
                    // current intent and the administrator may reissue it.
                    return await reply
                        .code(homeGovernanceErrorHttpStatusV1("account_erasure_incomplete"))
                        .send({ error: "account_erasure_incomplete" as const });
                default:
                    // Access is already revoked and the row is terminally
                    // retired with its exact locators intact. This is a failure
                    // the administrator retries, never a successful deletion.
                    return await reply.send({ status: "disabled_pending_completion" as const });
            }
        },
    );

    app.post(
        homeDomainActionPathForMethod('home.policy.set', 'POST'),
        {
            preHandler: [app.authenticate],
            attachValidation: true,
            schema: {
                body: HomeGovernancePolicySetInputV1Schema,
                response: { 200: HomeGovernancePolicyProjectionV1Schema, ...ERROR_RESPONSES },
            },
            config: GOVERNANCE_RATE_LIMIT,
        },
        async (request, reply) => {
            if (request.validationError) return await reply.code(400).send({ error: "invalid_home_input" as const });
            const outcome = await setHomeGovernancePolicy({
                actorAccountId: request.userId,
                patch: request.body,
                env: process.env,
            });
            if (outcome.status === "forbidden") {
                return await reply
                    .code(homeGovernanceErrorHttpStatusV1("home_governance_forbidden"))
                    .send({ error: "home_governance_forbidden" as const });
            }
            if (outcome.status === "revision_conflict") {
                // The draft is preserved by the client; it reloads the current
                // policy and reapplies rather than overwriting another editor.
                return await reply
                    .code(homeGovernanceErrorHttpStatusV1("home_policy_revision_conflict"))
                    .send({ error: "home_policy_revision_conflict" as const });
            }
            if (outcome.status === "invalid_policy") {
                return await reply
                    .code(homeGovernanceErrorHttpStatusV1("home_policy_invalid"))
                    .send({ error: "home_policy_invalid" as const });
            }
            return await reply.send(projectHomeGovernancePolicyV1(outcome.policy));
        },
    );
}
