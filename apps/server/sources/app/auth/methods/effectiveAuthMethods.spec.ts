import { describe, expect, it } from "vitest";

import {
    OLD_CLIENT_UNSAFE_AUTH_METHOD_IDS,
    findEffectiveAuthMethodDecision,
    isEffectiveAuthMethodActionEnabled,
    resolveEffectiveAuthMethodDecisions,
    toOldClientSafeAuthMethods,
    type EffectiveAuthMethodInputs,
} from "@/app/auth/methods/effectiveAuthMethods";
import { resolveAuthFeature } from "@/app/features/authFeature";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
        ...overrides,
    };
}

describe("effective auth method decisions", () => {
    it("requires the effective Key Challenge finalizer for E2EE password login", () => {
        const env = baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" });
        const login = (inputs: EffectiveAuthMethodInputs) => findEffectiveAuthMethodDecision(inputs, "email_password")
            ?.actions.find(({ id }) => id === "login");
        expect(login({ env: { ...env, HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0" } }))
            .toMatchObject({ enabled: false });
        expect(login({ env, homeAuthenticationPolicy: { status: "narrowed", policy: {
            v: 1, enabledMethodIds: ["email_password"],
        } } })).toMatchObject({ enabled: false });
        expect(login({ env: { ...env, HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1", HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional" } }))
            .toMatchObject({ enabled: true, mode: "keyless" });
    });
    it("narrows only provisioning to permitted Account modes and preserves existing-Account actions", () => {
        const decision = findEffectiveAuthMethodDecision({
            env: baseEnv({
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "1",
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            }),
            emailDeliveryReady: true,
            homeAuthenticationPolicy: { status: "narrowed", policy: {
                v: 1, permittedAccountModes: ["e2ee"],
            } },
        }, "email_password");
        expect(decision?.allowedProvisionModes).toEqual(["e2ee"]);
        expect(decision?.actions.find(({ id }) => id === "login")).toMatchObject({ enabled: true, mode: "either" });
        expect(decision?.actions.find(({ id }) => id === "connect")).toMatchObject({ enabled: true, mode: "either" });
        expect(decision?.actions.find(({ id }) => id === "provision")).toMatchObject({ mode: "keyed" });
    });
    it("narrows publication, admission and startup together using persisted Home policy", () => {
        const inputs: EffectiveAuthMethodInputs = {
            env: baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" }),
            homeAuthenticationPolicy: { status: "narrowed", policy: {
                v: 1, enabledMethodIds: ["email_password"], admission: "invitation_only",
            } },
        };
        expect(findEffectiveAuthMethodDecision(inputs, "key_challenge")?.actions.every((a) => !a.enabled)).toBe(true);
        expect(isEffectiveAuthMethodActionEnabled(inputs, "key_challenge", "login")).toBe(false);
        expect(isEffectiveAuthMethodActionEnabled(inputs, "email_password", "login")).toBe(false);
        const publication = toOldClientSafeAuthMethods(resolveEffectiveAuthMethodDecisions(inputs));
        expect(publication.find((m) => m.id === "key_challenge")?.actions.every((a) => !a.enabled)).toBe(true);
    });

    it("fails unreadable Home policy closed and never widens deployment mode or signup ceilings", () => {
        const env = baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" });
        expect(resolveEffectiveAuthMethodDecisions({ env, homeAuthenticationPolicy: { status: "unreadable" } })
            .every((m) => m.actions.every((a) => !a.enabled))).toBe(true);
        const decision = findEffectiveAuthMethodDecision({ env, homeAuthenticationPolicy: {
            status: "narrowed", policy: { v: 1, permittedAccountModes: ["plain"], admission: "self_service" },
        } }, "email_password");
        expect(decision?.allowedProvisionModes).toEqual([]);
        expect(decision?.actions.find((a) => a.id === "provision")?.enabled).toBe(false);
        expect(decision?.actions.find((a) => a.id === "login")?.enabled).toBe(true);
    });

    it("keeps email_password known but disables every action when the deployment has not enabled it", () => {
        const decisions = resolveEffectiveAuthMethodDecisions({ env: baseEnv() });
        expect(decisions.map((d) => d.id)).toContain("key_challenge");
        expect(findEffectiveAuthMethodDecision({ env: baseEnv() }, "email_password")?.actions
            .every((action) => !action.enabled)).toBe(true);
    });

    it("publishes login/connect for an enabled email_password Home and keeps provisioning closed by default", () => {
        const env = baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" });
        const decision = findEffectiveAuthMethodDecision({ env }, "email_password");
        expect(decision).not.toBeNull();
        const login = decision!.actions.find((a) => a.id === "login");
        const connect = decision!.actions.find((a) => a.id === "connect");
        const provision = decision!.actions.find((a) => a.id === "provision");
        expect(login?.enabled).toBe(true);
        expect(connect?.enabled).toBe(true);
        // Self-service admission is a separate deployment decision.
        expect(provision?.enabled).toBe(false);
        expect(provision?.reason).toBe("provisioning_not_enabled");
    });

    it("fails self-service provisioning closed while transactional mail readiness is unknown", () => {
        const env = baseEnv({
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "1",
        });
        const unknownReadiness = findEffectiveAuthMethodDecision({ env }, "email_password");
        const provision = unknownReadiness!.actions.find((a) => a.id === "provision");
        expect(provision?.enabled).toBe(false);
        expect(provision?.reason).toBe("email_delivery_unavailable");

        const ready = findEffectiveAuthMethodDecision({ env, emailDeliveryReady: true }, "email_password");
        expect(ready!.actions.find((a) => a.id === "provision")?.enabled).toBe(true);
    });

    it("derives action modes and allowed provision modes from the canonical encryption/storage policy owner", () => {
        const bothModes = findEffectiveAuthMethodDecision(
            {
                env: baseEnv({
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
                    HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
                    HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                }),
            },
            "email_password",
        );
        expect([...bothModes!.allowedProvisionModes].sort()).toEqual(["e2ee", "plain"]);
        expect(bothModes!.actions.find((a) => a.id === "login")?.mode).toBe("either");

        const e2eeOnly = findEffectiveAuthMethodDecision(
            {
                env: baseEnv({
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
                    HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "required_e2ee",
                }),
            },
            "email_password",
        );
        expect([...e2eeOnly!.allowedProvisionModes]).toEqual(["e2ee"]);
        expect(e2eeOnly!.recommendedProvisionMode).toBe("e2ee");
        expect(e2eeOnly!.actions.find((a) => a.id === "login")?.mode).toBe("keyed");
    });

    it("answers route admission from the same decision that publication uses", () => {
        const enabled = baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" });
        expect(isEffectiveAuthMethodActionEnabled({ env: enabled }, "email_password", "login")).toBe(true);
        expect(isEffectiveAuthMethodActionEnabled({ env: baseEnv() }, "email_password", "login")).toBe(false);
        // Unknown methods and unknown actions fail closed.
        expect(isEffectiveAuthMethodActionEnabled({ env: enabled }, "totally_unknown", "login")).toBe(false);
    });

    it("passes invitation admission context through deployment-provider decisions", () => {
        const env = baseEnv({
            AUTH_SIGNUP_PROVIDERS: "github",
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
        });
        const homeAuthenticationPolicy = { status: "narrowed" as const, policy: {
            v: 1 as const,
            admission: "invitation_only" as const,
        } };
        const provision = (admission?: { kind: "team_invitation" }) =>
            findEffectiveAuthMethodDecision({ env, homeAuthenticationPolicy, ...(admission ? { admission } : {}) }, "github")
                ?.actions.find((action) => action.id === "provision" && action.mode === "keyed");

        expect(provision()).toMatchObject({ enabled: false, reason: "provisioning_not_enabled" });
        expect(provision({ kind: "team_invitation" })).toMatchObject({ enabled: true });
    });

});

describe("old-client-safe /v1/features projection", () => {
    const env = {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
        HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
        HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "1",
    } satisfies NodeJS.ProcessEnv;

    it("names email_password as unsafe for the supported released clients", () => {
        expect(OLD_CLIENT_UNSAFE_AUTH_METHOD_IDS).toContain("email_password");
    });

    it("omits email_password from every released method list", () => {
        const feature = resolveAuthFeature(env);
        const auth = feature.capabilities!.auth!;
        expect(auth.methods).toBeDefined();
        expect(auth.login?.methods).toBeDefined();
        expect(auth.signup?.methods).toBeDefined();
        expect(auth.methods!.map((m) => m.id)).not.toContain("email_password");
        expect(auth.login!.methods!.map((m) => m.id)).not.toContain("email_password");
        expect(auth.signup!.methods!.map((m) => m.id)).not.toContain("email_password");
    });

    it("still publishes the existing methods unchanged", () => {
        const feature = resolveAuthFeature(env);
        const auth = feature.capabilities!.auth!;
        expect(auth.methods).toBeDefined();
        expect(auth.login?.methods).toBeDefined();
        expect(auth.methods!.map((m) => m.id)).toContain("key_challenge");
        expect(auth.login!.methods!.map((m) => m.id)).toEqual(["key_challenge", "mtls"]);
    });
});
