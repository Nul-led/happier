export const TEAM_CREDENTIAL_ONLY_USAGE_SOURCES = Object.freeze([
    "team_credential_admission",
    "team_credential_external_terminal",
] as const);

export function isTeamCredentialOnlyUsageSource(source: string | null): boolean {
    return source !== null && (TEAM_CREDENTIAL_ONLY_USAGE_SOURCES as readonly string[]).includes(source);
}

export type TeamCredentialUsageObservationClass =
    | "request_admission"
    | "agent_observed"
    | "external_terminal";

/**
 * Classifies one resource-attributed UsageEvent into the three disjoint
 * observation families exposed by the Team credential usage query.
 */
export function classifyTeamCredentialUsageObservationSource(
    source: string | null,
): TeamCredentialUsageObservationClass {
    if (source === "team_credential_admission") return "request_admission";
    if (source === "team_credential_external_terminal") return "external_terminal";
    return "agent_observed";
}
