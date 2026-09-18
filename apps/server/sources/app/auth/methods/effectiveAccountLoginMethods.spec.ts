import { describe, expect, it } from "vitest";
import {
    buildAccountLoginViabilityFactsAfterProviderRemoval,
    checkAccountRetainsLoginRouteForDecisions,
    resolveAvailableAccountAuthenticationMethodIdsForDecisions,
} from "./effectiveAccountLoginMethods";

describe("effective Account recovery viability", () => {
    it("does not retain a login or authentication choice that only accepts the opposite Account mode", () => {
        const facts = {
            encryptionMode: "plain" as const, accountActive: true,
            hasPasswordCredential: true, hasNativeEmailIdentity: true,
            providerIdentities: [], hasKeyChallengeCapableCredential: false,
            isLastHomeAdministrator: false,
        };
        const decision = {
            id: "email_password", actions: [{ id: "login" as const, enabled: true, mode: "keyed" as const }],
            allowedProvisionModes: [], recommendedProvisionMode: null,
        };
        expect(checkAccountRetainsLoginRouteForDecisions([decision], facts))
            .toEqual({ ok: false, reason: "account_would_lose_all_login_routes" });
        expect(resolveAvailableAccountAuthenticationMethodIdsForDecisions([decision], facts)).toEqual([]);
        expect(checkAccountRetainsLoginRouteForDecisions([{
            ...decision, actions: [{ id: "login", enabled: true, mode: "either" }],
        }], facts)).toEqual({ ok: true });
    });
    it("refuses password removal when the Home owner supplies no enabled key-challenge decision", () => {
        const facts = {
            encryptionMode: "e2ee" as const, accountActive: true,
            hasPasswordCredential: false, hasNativeEmailIdentity: false,
            providerIdentities: [], hasKeyChallengeCapableCredential: true,
            isLastHomeAdministrator: false,
        };
        expect(checkAccountRetainsLoginRouteForDecisions([], facts))
            .toEqual({ ok: false, reason: "account_would_lose_all_login_routes" });
        expect(checkAccountRetainsLoginRouteForDecisions([{
            id: "key_challenge",
            actions: [{ id: "login", enabled: true, mode: "keyed" }],
            allowedProvisionModes: [],
            recommendedProvisionMode: null,
        }], facts))
            .toEqual({ ok: true });
    });

    it("uses the caller's complete Home decisions for managed provider identities", () => {
        const facts = {
            encryptionMode: "plain" as const,
            accountActive: true,
            hasPasswordCredential: false,
            hasNativeEmailIdentity: false,
            providerIdentities: [{ providerId: "managed-okta", blocked: false }],
            hasKeyChallengeCapableCredential: false,
            isLastHomeAdministrator: false,
        };
        expect(checkAccountRetainsLoginRouteForDecisions([{
            id: "managed-okta",
            actions: [{ id: "login", enabled: true, mode: "keyless" }],
            allowedProvisionModes: [],
            recommendedProvisionMode: null,
        }], facts)).toEqual({ ok: true });
        expect(checkAccountRetainsLoginRouteForDecisions([], facts))
            .toEqual({ ok: false, reason: "account_would_lose_all_login_routes" });
    });

    it("treats connect-only identity methods as possible Team authentication choices", () => {
        const facts = {
            encryptionMode: "plain" as const,
            accountActive: true,
            hasPasswordCredential: false,
            hasNativeEmailIdentity: false,
            providerIdentities: [{ providerId: "managed-okta", blocked: false }],
            hasKeyChallengeCapableCredential: false,
            isLastHomeAdministrator: false,
        };
        const decisions = [{
            id: "managed-okta",
            actions: [{ id: "connect" as const, enabled: true, mode: "either" as const }],
            allowedProvisionModes: [],
            recommendedProvisionMode: null,
        }];
        expect(resolveAvailableAccountAuthenticationMethodIdsForDecisions(decisions, facts))
            .toEqual(["managed-okta"]);
        expect(checkAccountRetainsLoginRouteForDecisions(decisions, facts))
            .toEqual({ ok: false, reason: "account_would_lose_all_login_routes" });
    });

    it("derives post-removal native aliases and current identity eligibility once", () => {
        const source = {
            status: "active",
            publicKey: null,
            encryptionMode: "plain",
            hasPasswordCredential: true,
            identities: [
                { provider: "email", eligibilityStatus: "eligible" as const },
                { provider: "managed-okta", eligibilityStatus: "ineligible" as const },
            ],
        };
        expect(buildAccountLoginViabilityFactsAfterProviderRemoval(source, {
            env: {},
            excludedProviderId: " EMAIL ",
            identityEligibility: "current",
        })).toMatchObject({
            hasNativeEmailIdentity: false,
            providerIdentities: [{ providerId: "managed-okta", blocked: true }],
        });
        expect(buildAccountLoginViabilityFactsAfterProviderRemoval(source, {
            env: {},
            excludedProviderId: "email",
            identityEligibility: "identity_presence",
        })).toMatchObject({
            providerIdentities: [{ providerId: "managed-okta", blocked: false }],
        });
    });
});
