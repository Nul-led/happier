import { describe, expect, it } from "vitest";

import { isRestrictedAuthTokenDeniedForRoute, readRestrictedCredentialRouteField } from "./apiTokenRouteAdmission";

const principal = {
    accountId: "account-1", principalId: "token-1", credentialId: "token-1",
    authority: "account_automation" as const, expiresAt: null, parentTokenId: null,
    grant: {
        v: 1 as const, actions: { families: [], ids: ["session.message.send"] },
        targets: { sessions: ["session-1"], machines: [] }, approve: false,
        origins: [], models: null, permissionModes: null, create: null,
    },
};

describe("scoped API-token route admission", () => {
    it("binds exactly one Session query selector and refuses combined or absent selectors", () => {
        const selector = ["query.sessionId", "query.sessionAccessSessionId"] as const;
        expect(readRestrictedCredentialRouteField({ query: { sessionId: "session-1" } }, selector)).toBe("session-1");
        expect(readRestrictedCredentialRouteField({ query: { sessionAccessSessionId: "session-2" } }, selector)).toBe("session-2");
        expect(readRestrictedCredentialRouteField({ query: { sessionId: "session-1", sessionAccessSessionId: "session-2" } }, selector)).toBeUndefined();
        expect(readRestrictedCredentialRouteField({ query: {} }, selector)).toBeUndefined();
    });
    it("refuses a restricted token on an ordinary API-token opt-in", () => {
        const request = { authTokenKind: "api_token", apiTokenPrincipal: principal,
            routeOptions: { config: { allowApiToken: true } } };
        expect(isRestrictedAuthTokenDeniedForRoute(request)).toBe(true);
    });

    it("admits explicit scoped surfaces and Session-action surfaces", () => {
        const scopedRequest = { authTokenKind: "api_token", apiTokenPrincipal: principal,
            routeOptions: { config: { allowApiToken: true, allowScopedApiToken: true } } };
        expect(isRestrictedAuthTokenDeniedForRoute(scopedRequest)).toBe(false);
        const sessionRequest = { authTokenKind: "api_token", apiTokenPrincipal: principal,
            params: { sessionId: "session-1" }, routeOptions: { config: {
                apiTokenSessionAction: "session.message.send",
                restrictedCredentialBinding: { scope: "session" as const, session: "params.sessionId" as const },
            } } };
        expect(isRestrictedAuthTokenDeniedForRoute(sessionRequest)).toBe(false);
    });

    it("retains the existing unrestricted bearer opt-in", () => {
        const unrestricted = { ...principal, grant: { ...principal.grant, actions: null, targets: null } };
        const request = { authTokenKind: "api_token", apiTokenPrincipal: unrestricted,
            routeOptions: { config: { allowApiToken: true } } };
        expect(isRestrictedAuthTokenDeniedForRoute(request)).toBe(false);
    });
});
