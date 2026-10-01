import {
    TeamErrorV1Schema,
    TeamIdentityConnectionCreateInputV1Schema,
    TeamIdentityConnectionListInputV1Schema,
    TeamIdentityConnectionListResultV1Schema,
    TeamIdentityConnectionMutationResultV1Schema,
    TeamIdentityConnectionRefInputV1Schema,
    TeamIdentityConnectionSettingsUpdateInputV1Schema,
    TeamIdentityConnectionRemoveResultV1Schema,
    TeamIdentityConnectionRemovalPreflightV1Schema,
    TeamIdentityConnectionTestConsumeInputV1Schema,
    TeamIdentityConnectionTestConsumeResultV1Schema,
    TeamIdentityConnectionTestStartInputV1Schema,
    TeamIdentityConnectionTestStartResultV1Schema,
    TeamIdentityErrorV1Schema,
    TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema,
    TeamIdentityWorkosAdminPortalLinkCreateResultV1Schema,
    TeamIdentityWorkosConnectionCreateInputV1Schema,
    TeamIdentityWorkosConnectionSetInputV1Schema,
    TeamIdentityWorkosReconcileInputV1Schema,
    TeamIdentityWorkosReconcileResultV1Schema,
    buildTeamMemberSignInUrl,
    teamIdentityErrorHttpStatusV1,
    type TeamIdentityErrorCodeV1,
} from "@happier-dev/protocol/teams";
import { TEAM_IDENTITY_ACTION_PATHS_V1 } from "@happier-dev/protocol/actions";
import type { FastifyReply } from "fastify";

import type { Fastify } from "@/app/api/types";
import { readTeamOperationAuthenticationFromRequest } from "../actorContext";
import { readRequestHomeEnv } from "@/app/home/settings/requestHomeEnv";
import {
    consumeTeamIdentityConnectionTestForActor,
    createTeamIdentityConnectionForActor,
    listTeamIdentityConnectionsForActor,
    preflightTeamIdentityConnectionRemovalForActor,
    removeTeamIdentityConnectionForActor,
    setTeamIdentityConnectionEnabledForActor,
    startTeamIdentityConnectionTestForActor,
    updateTeamIdentityConnectionSettingsForActor,
} from "./teamIdentityConnectionAdministration";
import {
    createTeamWorkosConnection,
    createTeamWorkosAdminPortalLink,
    reconcileTeamWorkosConnection,
    setTeamWorkosConnection,
    type WorkosAdministrationDependencies,
} from "./teamWorkosAdministration";

// These routes sit behind the shared `teams` gate, whose disabled answer is the
// family envelope `{ error: "teams_unavailable" }`. That code is not an identity
// *service* result, so the declared failure contract is the identity vocabulary
// unioned with the family envelope — the same declared union the directory
// routes use behind the same gate.
const IdentityRouteErrorV1Schema = TeamIdentityErrorV1Schema.or(TeamErrorV1Schema);
const ErrorResponses = {
    400: IdentityRouteErrorV1Schema,
    403: IdentityRouteErrorV1Schema,
    404: IdentityRouteErrorV1Schema,
    409: IdentityRouteErrorV1Schema,
    503: IdentityRouteErrorV1Schema,
} as const;

function sendError(reply: FastifyReply, error: TeamIdentityErrorCodeV1) {
    return reply.code(teamIdentityErrorHttpStatusV1(error)).send({ error });
}

/**
 * What this route family needs beyond its own transactions.
 *
 * The member sign-in link resolver is the same one Team invitations use, so a
 * member link and an invitation link always name the identical Home. A Home
 * that publishes no application origin or portable carrier renders `null`,
 * which the overview presents as unavailable rather than as a link that only
 * works on devices which already know this Home.
 */
export type TeamIdentityRouteDependencies = WorkosAdministrationDependencies & Readonly<{
    resolveMemberSignInLinkTarget?: () => Promise<Readonly<{
        applicationOrigin: string | null;
        homeTarget: string | null;
    }>>;
}>;

export function registerTeamIdentityRoutes(
    app: Fastify,
    dependencies: TeamIdentityRouteDependencies = {},
) {
    const workosDependencies: WorkosAdministrationDependencies = dependencies;

    async function renderMemberSignInUrl(teamId: string): Promise<string | null> {
        const resolve = dependencies.resolveMemberSignInLinkTarget;
        if (!resolve) return null;
        const target = await resolve();
        if (target.applicationOrigin === null || !target.homeTarget?.trim()) return null;
        try {
            return buildTeamMemberSignInUrl({
                applicationOrigin: target.applicationOrigin,
                teamId,
                homeTarget: target.homeTarget,
            });
        } catch {
            // A misconfigured origin is an operator fact, not a reason to fail
            // the whole overview the administrator came here to read.
            return null;
        }
    }

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.list"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionListInputV1Schema,
            response: { 200: TeamIdentityConnectionListResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await listTeamIdentityConnectionsForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        if (!result.ok) return sendError(reply, result.error);
        return reply.send({
            ...result.value,
            memberSignInUrl: await renderMemberSignInUrl(request.body.teamId),
        });
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.create"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionCreateInputV1Schema,
            response: { 200: TeamIdentityConnectionMutationResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await createTeamIdentityConnectionForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        return result.ok ? reply.send({ connection: result.value }) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.settings.update"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionSettingsUpdateInputV1Schema,
            response: { 200: TeamIdentityConnectionMutationResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await updateTeamIdentityConnectionSettingsForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        return result.ok ? reply.send({ connection: result.value }) : sendError(reply, result.error);
    });

    for (const [path, enabled] of [
        [TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.enable"], true],
        [TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.disable"], false],
    ] as const) {
        app.post(path, {
            preHandler: app.authenticate,
            schema: {
                body: TeamIdentityConnectionRefInputV1Schema,
                response: { 200: TeamIdentityConnectionMutationResultV1Schema, ...ErrorResponses },
            },
        }, async (request, reply) => {
            const result = await setTeamIdentityConnectionEnabledForActor({
                ...request.body,
                actorAccountId: request.userId,
                enabled,
                ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
            }, workosDependencies);
            return result.ok ? reply.send({ connection: result.value }) : sendError(reply, result.error);
        });
    }

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.remove"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionRefInputV1Schema,
            response: { 200: TeamIdentityConnectionRemoveResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await removeTeamIdentityConnectionForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        }, workosDependencies);
        return result.ok ? reply.send(result.value) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.remove.preview"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionRefInputV1Schema,
            response: { 200: TeamIdentityConnectionRemovalPreflightV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await preflightTeamIdentityConnectionRemovalForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        return result.ok ? reply.send(result.value) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.test.consume"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionTestConsumeInputV1Schema,
            response: { 200: TeamIdentityConnectionTestConsumeResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await consumeTeamIdentityConnectionTestForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        reply.header("Cache-Control", "no-store");
        return result.ok ? reply.send(result.value) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.connections.test.start"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityConnectionTestStartInputV1Schema,
            response: { 200: TeamIdentityConnectionTestStartResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await startTeamIdentityConnectionTestForActor({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        });
        reply.header("Cache-Control", "no-store");
        return result.ok ? reply.send(result.value) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.workos.adminPortalLink.create"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema,
            response: { 200: TeamIdentityWorkosAdminPortalLinkCreateResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await createTeamWorkosAdminPortalLink({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        }, workosDependencies);
        if (!result.ok) return sendError(reply, result.error);
        reply.header("Cache-Control", "no-store");
        return reply.send(result.value);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.workos.connection.create"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityWorkosConnectionCreateInputV1Schema,
            response: { 200: TeamIdentityConnectionMutationResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await createTeamWorkosConnection({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        }, workosDependencies);
        return result.ok ? reply.send({ connection: result.value }) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.workos.reconcile"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityWorkosReconcileInputV1Schema,
            response: { 200: TeamIdentityWorkosReconcileResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await reconcileTeamWorkosConnection({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        }, workosDependencies);
        return result.ok ? reply.send(result.value) : sendError(reply, result.error);
    });

    app.post(TEAM_IDENTITY_ACTION_PATHS_V1["teams.identity.workos.connection.set"], {
        preHandler: app.authenticate,
        schema: {
            body: TeamIdentityWorkosConnectionSetInputV1Schema,
            response: { 200: TeamIdentityConnectionMutationResultV1Schema, ...ErrorResponses },
        },
    }, async (request, reply) => {
        const result = await setTeamWorkosConnection({
            ...request.body,
            actorAccountId: request.userId,
            ...readTeamOperationAuthenticationFromRequest(request, await readRequestHomeEnv(request)),
        }, workosDependencies);
        return result.ok ? reply.send({ connection: result.value }) : sendError(reply, result.error);
    });
}
