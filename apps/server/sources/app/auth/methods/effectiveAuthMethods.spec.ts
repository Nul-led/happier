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

/** A deployment that used the operator opt-out to turn native password auth off entirely. */
function emailPasswordOptedOutEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "0", ...overrides });
}

describe("effective auth method decisions", () => {
    it("requires the effective Key Challenge finalizer for E2EE password login", () => {
        const env = baseEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1" });
        const login = (inputs: EffectiveAuthMethodInputs) => findEffectiveAuthMethodDecision(inputs, "email_password")
            ?.actions.find(({ id }) => id === "login");
        // Without the finalizer the keyed branch of password login is withdrawn;
        // the Plain branch does not depend on it and survives as `keyless`.
        expect(login({ env: { ...env, HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0" } }))
            .toMatchObject({ enabled: true, mode: "keyless" });
        expect(login({ env, homeAuthenticationPolicy: { status: "narrowed", policy: {
            v: 1, enabledMethodIds: ["email_password"],
        } } })).toMatchObject({ enabled: true, mode: "keyless" });
        expect(login({ env: { ...env, HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1", HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional" } }))
            .toMatchObject({ enabled: true, mode: "keyless" });
        // The operator opt-out is still the one answer that removes login.
        expect(login({ env: emailPasswordOptedOutEnv() })).toMatchObject({ enabled: false, reason: "method_not_enabled" });
    });
    it("keeps deployment Account-mode narrowing on provisioning so an existing Plain Account can still sign in", () => {
        // A Home that created Plain password Accounts and later turned keyless
        // accounts off (or required E2EE) must not strand them: the deployment
        // Account-mode policy governs construction of new Accounts only.
        const e2eeOnlyDeployment = findEffectiveAuthMethodDecision({
            env: baseEnv({
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "required_e2ee",
            }),
            emailDeliveryReady: true,
        }, "email_password");
        expect([...e2eeOnlyDeployment!.allowedProvisionModes]).toEqual(["e2ee"]);
        expect(e2eeOnlyDeployment!.actions.find((a) => a.id === "provision"))
            .toMatchObject({ enabled: true, mode: "keyed" });
        expect(e2eeOnlyDeployment!.actions.find((a) => a.id === "login"))
            .toMatchObject({ enabled: true, mode: "either" });
        expect(e2eeOnlyDeployment!.actions.find((a) => a.id === "connect"))
            .toMatchObject({ enabled: true, mode: "either" });
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
        // Disabling `key_challenge` withdraws the keyed branch of password login,
        // not the method: an existing Plain password Account must still sign in.
        expect(findEffectiveAuthMethodDecision(inputs, "email_password")?.actions
            .find(({ id }) => id === "login")).toMatchObject({ enabled: true, mode: "keyless" });
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

    it("keeps email_password known but disables every action when the operator opted the deployment out", () => {
        const decisions = resolveEffectiveAuthMethodDecisions({ env: emailPasswordOptedOutEnv() });
        expect(decisions.map((d) => d.id)).toContain("key_challenge");
        expect(findEffectiveAuthMethodDecision({ env: emailPasswordOptedOutEnv() }, "email_password")?.actions
            .every((action) => !action.enabled)).toBe(true);
    });

    it("publishes login/connect on a default Home with no deployment opt-in", () => {
        // No `HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__*` key is set: the method is
        // a shipped capability, and the Home governance policy plus mail
        // readiness are what decide it. Nothing answers `method_not_enabled`.
        const decision = findEffectiveAuthMethodDecision({ env: baseEnv() }, "email_password");
        expect(decision).not.toBeNull();
        expect(decision!.actions.find((a) => a.id === "login")?.enabled).toBe(true);
        expect(decision!.actions.find((a) => a.id === "connect")?.enabled).toBe(true);
        expect(decision!.actions.some((a) => a.reason === "method_not_enabled")).toBe(false);
    });

    it("fails self-service provisioning closed while transactional mail readiness is unknown", () => {
        const env = baseEnv();
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
        expect(e2eeOnly!.actions.find((a) => a.id === "provision")?.mode).toBe("keyed");
        expect(e2eeOnly!.actions.find((a) => a.id === "login")?.mode).toBe("either");
    });

    it("answers route admission from the same decision that publication uses", () => {
        const enabled = baseEnv();
        expect(isEffectiveAuthMethodActionEnabled({ env: enabled }, "email_password", "login")).toBe(true);
        expect(isEffectiveAuthMethodActionEnabled({ env: emailPasswordOptedOutEnv() }, "email_password", "login")).toBe(false);
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
