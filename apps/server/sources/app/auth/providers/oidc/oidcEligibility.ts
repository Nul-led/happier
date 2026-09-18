import type { OidcAuthProviderInstanceConfig } from "./oidcProviderConfig";
import type { NormalizedOidcIdentityClaims } from "./normalizeOidcIdentityClaims";

/** The same rule outcomes drive sign-in admission and administrator test diagnostics. */
export function evaluateOidcEligibility(
    allow: OidcAuthProviderInstanceConfig["allow"],
    claims: Readonly<NormalizedOidcIdentityClaims>,
) {
    const rules: { kind: "users" | "email_domains" | "groups_any" | "groups_all"; matched: boolean }[] = [];
    if (allow.usersAllowlist.length > 0) {
        rules.push({ kind: "users", matched: claims.login !== null && allow.usersAllowlist.includes(claims.login) });
    }
    if (allow.emailDomains.length > 0) {
        const domain = claims.email?.slice(claims.email.lastIndexOf("@") + 1).trim().toLowerCase();
        rules.push({ kind: "email_domains", matched: claims.emailVerified && Boolean(domain && allow.emailDomains.includes(domain)) });
    }
    const groups = !claims.groupsIncomplete ? claims.groups : null;
    if (allow.groupsAny.length > 0) {
        rules.push({ kind: "groups_any", matched: groups !== null && allow.groupsAny.some(group => groups.includes(group)) });
    }
    if (allow.groupsAll.length > 0) {
        rules.push({ kind: "groups_all", matched: groups !== null && allow.groupsAll.every(group => groups.includes(group)) });
    }
    return { status: rules.every(rule => rule.matched) ? "eligible" as const : "ineligible" as const, rules };
}
