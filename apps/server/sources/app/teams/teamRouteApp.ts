import type { Fastify } from "@/app/api/types";
import {
    createServerFeatureGatedRouteApp,
    type ServerFeatureUnavailableBody,
} from "@/app/features/catalog/serverFeatureGate";

type TeamRouteAppOptions = Readonly<{
    env?: NodeJS.ProcessEnv;
    unavailableBody?: ServerFeatureUnavailableBody;
    unavailableStatus?: number;
}>;

/**
 * Create the route app shared by every Team-authorized HTTP family.
 *
 * The Team feature decision and refusal of released pre-provenance Home
 * credentials are one composition policy. Keeping both here prevents a newly
 * split registrar from inheriting ordinary-Home legacy-token authority.
 */
export function createTeamRouteApp(
    app: Fastify,
    options: TeamRouteAppOptions = {},
): Fastify {
    return createServerFeatureGatedRouteApp(
        app,
        "teams",
        options.env ?? process.env,
        options.unavailableBody ?? { error: "teams_unavailable" },
        options.unavailableStatus ?? 404,
        {
            allowLegacyHomeToken: false,
            // Team routes publish one strict domain error envelope. Restricted
            // credentials fail before domain lookup, so use its opaque denial
            // member instead of serializing a generic auth body the route does
            // not declare.
            restrictedAuthFailureError: "team_forbidden",
        },
    );
}
