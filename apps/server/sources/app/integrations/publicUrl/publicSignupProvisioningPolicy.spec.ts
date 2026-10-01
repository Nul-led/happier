import { describe, expect, it } from "vitest";

import { resolveFeaturesFromEnv } from "@/app/features/registry";

import { classifyRequestIp } from "@/app/net/requestOrigin";
import { resolveEffectiveAuthMethodDecisions, toPublishedAuthMethods } from "@/app/auth/methods/effectiveAuthMethods";

import {
    applyPublicSignupProvisioningRestrictionsToFeaturesPayload,
    shouldDenyPublicSignupProvisioningAction,
} from "./publicSignupProvisioningPolicy";

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}

function findActionEnabled(payload: unknown, methodId: string, actionMode: "keyed" | "keyless"): boolean | null {
    if (!isRecord(payload)) return null;
    const capabilities = payload.capabilities;
    if (!isRecord(capabilities)) return null;
    const auth = capabilities.auth;
    if (!isRecord(auth)) return null;
    const methods = auth.methods;
    if (!Array.isArray(methods)) return null;

    const method = methods.find((candidate) => {
        return isRecord(candidate) && String(candidate.id ?? "").toLowerCase() === methodId.toLowerCase();
    });
    if (!isRecord(method)) return null;
    const actions = method.actions;
    if (!Array.isArray(actions)) return null;

    const action = actions.find((candidate) => {
        return isRecord(candidate) && candidate.id === "provision" && candidate.mode === actionMode;
    });
    if (!isRecord(action)) return null;
    return typeof action.enabled === "boolean" ? action.enabled : null;
}

describe("publicSignupProvisioningPolicy", () => {
    it("classifies request IPs for provisioning decisions", () => {
        expect(classifyRequestIp("203.0.113.5")).toBe("public");
        expect(classifyRequestIp("10.0.0.5")).toBe("private");
        expect(classifyRequestIp("::ffff:192.168.0.5")).toBe("private");
        expect(classifyRequestIp("not-an-ip")).toBe("unknown");
    });

    it("denies only matching methods and modes on public requests", () => {
        const env = {
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyed",
        } as NodeJS.ProcessEnv;

        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "203.0.113.10",
                methodId: "key_challenge",
                mode: "keyed",
            }),
        ).toBe(true);
        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "10.0.0.5",
                methodId: "key_challenge",
                mode: "keyed",
            }),
        ).toBe(false);
        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "203.0.113.10",
                methodId: "key_challenge",
                mode: "keyless",
            }),
        ).toBe(false);
    });

    it("denies a combined provision action only when both branches are denied", () => {
        const env = {
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "email_password",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyless",
        } as NodeJS.ProcessEnv;

        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "203.0.113.10",
                methodId: "email_password",
                mode: "either",
            }),
        ).toBe(false);
        expect(shouldDenyPublicSignupProvisioningAction({
            env: { ...env, HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "*" },
            requestIp: "203.0.113.10", methodId: "email_password", mode: "either",
        })).toBe(true);
        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "10.0.0.5",
                methodId: "email_password",
                mode: "either",
            }),
        ).toBe(false);
        expect(
            shouldDenyPublicSignupProvisioningAction({
                env,
                requestIp: "203.0.113.10",
                methodId: "key_challenge",
                mode: "either",
            }),
        ).toBe(false);
    });

    it.each([
        { denied: "keyed", surviving: "keyless" },
        { denied: "keyless", surviving: "keyed" },
    ] as const)("publishes the surviving $surviving native branch when $denied is restricted", ({ denied, surviving }) => {
        const env = {
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "1",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "email_password",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: denied,
        };
        const payload = resolveFeaturesFromEnv(env);
        payload.capabilities.auth.methods = toPublishedAuthMethods(resolveEffectiveAuthMethodDecisions({ env, emailDeliveryReady: true }));
        const restricted = applyPublicSignupProvisioningRestrictionsToFeaturesPayload({ payload, env, requestIp: "203.0.113.10" });
        const native = restricted.capabilities.auth.methods?.find(method => method.id === "email_password");
        expect(native?.actions).toEqual(expect.arrayContaining([
            { id: "provision", enabled: true, mode: surviving },
            { id: "login", enabled: true, mode: "either" },
        ]));
        const privatePayload = applyPublicSignupProvisioningRestrictionsToFeaturesPayload({ payload, env, requestIp: "10.0.0.5" });
        expect(privatePayload.capabilities.auth.methods?.find(method => method.id === "email_password")?.actions)
            .toContainEqual({ id: "provision", enabled: true, mode: "either" });
    });

    it("disables only matching provision actions for public requests", () => {
        const payload = resolveFeaturesFromEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            GITHUB_CLIENT_ID: "id",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://example.com/v1/oauth/github/callback",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge,github",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyed,keyless",
        } as NodeJS.ProcessEnv);

        expect(findActionEnabled(payload, "key_challenge", "keyed")).toBe(true);
        expect(findActionEnabled(payload, "github", "keyless")).toBe(true);

        const restricted = applyPublicSignupProvisioningRestrictionsToFeaturesPayload({
            payload,
            env: {
                HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge,github",
                HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyed,keyless",
            } as NodeJS.ProcessEnv,
            requestIp: "203.0.113.10",
        });
        expect(findActionEnabled(restricted, "key_challenge", "keyed")).toBe(false);
        expect(findActionEnabled(restricted, "github", "keyless")).toBe(false);
        expect(
            restricted.capabilities.auth.methods?.find((method: any) => String(method?.id ?? "").toLowerCase() === "github")
                ?.actions,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ id: "login", enabled: true, mode: "keyless" })]));
    });

    it("also disables matching signup methods for public requests", () => {
        const payload = resolveFeaturesFromEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
            AUTH_SIGNUP_PROVIDERS: "github",
            GITHUB_CLIENT_ID: "id",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://example.com/v1/oauth/github/callback",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge,github",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyed",
        } as NodeJS.ProcessEnv);

        const restricted = applyPublicSignupProvisioningRestrictionsToFeaturesPayload({
            payload,
            env: {
                HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge,github",
                HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyed",
            } as NodeJS.ProcessEnv,
            requestIp: "203.0.113.10",
        });

        expect(
            restricted.capabilities.auth.signup.methods.find((method: any) => String(method?.id ?? "").toLowerCase() === "anonymous"),
        ).toEqual(expect.objectContaining({ enabled: false }));
        expect(
            restricted.capabilities.auth.signup.methods.find((method: any) => String(method?.id ?? "").toLowerCase() === "github"),
        ).toEqual(expect.objectContaining({ enabled: false }));
    });

    it("does not disable provisioning for private requests", () => {
        const payload = resolveFeaturesFromEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge",
        } as NodeJS.ProcessEnv);

        const restricted = applyPublicSignupProvisioningRestrictionsToFeaturesPayload({
            payload,
            env: {
                HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "key_challenge",
            } as NodeJS.ProcessEnv,
            requestIp: "10.0.0.5",
        });

        expect(findActionEnabled(restricted, "key_challenge", "keyed")).toBe(true);
    });
});
