import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initEncrypt } from "@/modules/encrypt";
import {
    applyGitHubAppSecretReplacementV1,
    createGitHubAppRegistrationConfigV1,
    decryptGitHubAppRegistrationSecretsV1,
    encryptGitHubAppRegistrationSecretsV1,
    githubAppRegistrationSecretEncryptionPathV1,
    parseGitHubAppRegistrationConfigV1,
    projectGitHubAppInstallationRequirementsV1,
    projectGitHubAppSecretHealthV1,
    resolveGitHubAppConsumerReadinessV1,
    validateGitHubAppInstallationEvidenceV1,
} from "./githubManagedApp";

describe("managed GitHub App owner", () => {
    const previousMasterSecret = process.env.HANDY_MASTER_SECRET;

    beforeAll(async () => {
        process.env.HANDY_MASTER_SECRET = "managed-github-app-test-master-secret";
        await initEncrypt();
    });

    afterAll(() => {
        if (previousMasterSecret === undefined) delete process.env.HANDY_MASTER_SECRET;
        else process.env.HANDY_MASTER_SECRET = previousMasterSecret;
    });

    it("strictly parses the versioned non-secret registration config", () => {
        expect(parseGitHubAppRegistrationConfigV1({ v: 1 })).toEqual({ v: 1 });
        expect(createGitHubAppRegistrationConfigV1({
            v: 1,
            clientSecret: "client-secret",
            privateKey: "private-key",
        })).toEqual({
            v: 1,
            secretHealth: {
                clientSecretConfigured: true,
                privateKeyConfigured: true,
                webhookSecretConfigured: false,
            },
        });
        expect(() => parseGitHubAppRegistrationConfigV1({ v: 1, identityEnabled: true })).toThrow();
        expect(() => parseGitHubAppRegistrationConfigV1({ v: 2 })).toThrow();
    });

    it("rejects an externally observed organization login beyond the persisted text bound", () => {
        expect(validateGitHubAppInstallationEvidenceV1({
            expected: { githubAppId: 1n, githubInstallationId: 2n, githubOrganizationId: 3n },
            observed: {
                githubAppId: 1n,
                githubInstallationId: 2n,
                githubOrganizationId: 3n,
                githubOrganizationLogin: "o".repeat(257),
                suspended: false,
                permissions: {},
                events: [],
                repositorySelection: "all",
            },
        })).toEqual({ ok: false, code: "github_installation_evidence_invalid" });
    });

    it("purpose-separates and seals the one versioned secret document", () => {
        const registrationId = "github_app_registration_1";
        expect(githubAppRegistrationSecretEncryptionPathV1(registrationId)).toEqual([
            "storage",
            "github_app_registration",
            registrationId,
            "secrets",
            "v1",
        ]);

        const encryptedSecrets = encryptGitHubAppRegistrationSecretsV1({
            registrationId,
            secrets: {
                v: 1,
                clientSecret: "client-secret",
                privateKey: "private-key",
            },
        });
        const storedBytes = Buffer.from(encryptedSecrets).toString("utf8");
        expect(storedBytes).not.toContain("client-secret");
        expect(storedBytes).not.toContain("private-key");
        expect(decryptGitHubAppRegistrationSecretsV1({ registrationId, encryptedSecrets })).toEqual({
            v: 1,
            clientSecret: "client-secret",
            privateKey: "private-key",
        });
        expect(() => decryptGitHubAppRegistrationSecretsV1({
            registrationId: "github_app_registration_2",
            encryptedSecrets,
        })).toThrow();
    });

    it("replaces only explicit secret slots and projects no secret values", () => {
        const current = {
            v: 1 as const,
            clientSecret: "client-secret-v1",
            privateKey: "private-key-v1",
        };
        const replaced = applyGitHubAppSecretReplacementV1(current, {
            clientSecret: "client-secret-v2",
        });

        expect(replaced).toEqual({
            v: 1,
            clientSecret: "client-secret-v2",
            privateKey: "private-key-v1",
        });
        expect(projectGitHubAppSecretHealthV1(replaced)).toEqual({
            clientSecretConfigured: true,
            privateKeyConfigured: true,
            webhookSecretConfigured: false,
        });
        expect(JSON.stringify(projectGitHubAppSecretHealthV1(replaced))).not.toContain("secret-v2");
    });

    it("accepts only evidence for the exact App, installation, and organization", () => {
        const expected = {
            githubAppId: 41n,
            githubInstallationId: 101n,
            githubOrganizationId: 201n,
        };
        expect(validateGitHubAppInstallationEvidenceV1({
            expected,
            observed: {
                githubAppId: 41n,
                githubInstallationId: 101n,
                githubOrganizationId: 201n,
                githubOrganizationLogin: "Acme",
                suspended: false,
                permissions: { members: "read" },
                events: [],
                repositorySelection: "selected",
            },
        })).toEqual({
            ok: true,
            value: {
                githubOrganizationLogin: "Acme",
                suspended: false,
                permissions: { members: "read" },
                events: [],
                repositorySelection: "selected",
            },
        });

        expect(validateGitHubAppInstallationEvidenceV1({
            expected,
            observed: {
                githubAppId: 42n,
                githubInstallationId: 101n,
                githubOrganizationId: 201n,
                githubOrganizationLogin: "Acme",
                suspended: false,
                permissions: { members: "read" },
                events: [],
                repositorySelection: "selected",
            },
        })).toEqual({ ok: false, code: "github_app_mismatch" });
        expect(validateGitHubAppInstallationEvidenceV1({
            expected,
            observed: {
                githubAppId: 41n,
                githubInstallationId: 101n,
                githubOrganizationId: 202n,
                githubOrganizationLogin: "Other",
                suspended: false,
                permissions: { members: "read" },
                events: [],
                repositorySelection: "selected",
            },
        })).toEqual({ ok: false, code: "github_organization_mismatch" });
    });

    it("rejects installation evidence that omits a required consumer permission", () => {
        expect(validateGitHubAppInstallationEvidenceV1({
            expected: {
                githubAppId: 41n,
                githubInstallationId: 101n,
                githubOrganizationId: 201n,
                requiredPermissions: { members: "read" },
            },
            observed: {
                githubAppId: 41n,
                githubInstallationId: 101n,
                githubOrganizationId: 201n,
                githubOrganizationLogin: "Acme",
                suspended: false,
                permissions: {},
                events: [],
                repositorySelection: "selected",
            },
        })).toEqual({ ok: false, code: "github_permission_missing", permission: "members" });
    });

    it("derives directory readiness from current evidence without a stored facet boolean", () => {
        const ready = resolveGitHubAppConsumerReadinessV1({
            purpose: { kind: "directorySync" },
            registration: {
                state: "verified",
                secretHealth: {
                    clientSecretConfigured: false,
                    privateKeyConfigured: true,
                    webhookSecretConfigured: false,
                },
            },
            installation: {
                state: "verified",
                suspended: false,
                permissions: { members: "read" },
                events: [],
            },
        });
        expect(ready).toEqual({ ok: true });

        expect(resolveGitHubAppConsumerReadinessV1({
            purpose: { kind: "directorySync" },
            registration: {
                state: "verified",
                secretHealth: {
                    clientSecretConfigured: false,
                    privateKeyConfigured: true,
                    webhookSecretConfigured: false,
                },
            },
            installation: {
                state: "verified",
                suspended: false,
                permissions: {},
                events: [],
            },
        })).toEqual({ ok: false, code: "github_permission_missing", permission: "members" });
    });

    it("projects the union of its consumers' requirements and only the unsatisfied ones as gaps", () => {
        expect(projectGitHubAppInstallationRequirementsV1({
            purposes: [
                { kind: "identity", requiresOrganizationEvidence: true },
                { kind: "directorySync" },
                {
                    kind: "repository",
                    requiredPermissions: { contents: "write", members: "read" },
                    requiredEvents: ["push", "pull_request"],
                    requiresWebhookSecret: true,
                },
            ],
            // `members` is granted at `write`, which satisfies a `read` ask; `contents`
            // is granted at `read`, which does not satisfy a `write` ask.
            permissions: { members: "write", contents: "read" },
            events: ["push"],
        })).toEqual({
            permissions: { contents: "write", members: "read" },
            events: ["pull_request", "push"],
            missingPermissions: [{ permission: "contents", required: "write" }],
            missingEvents: ["pull_request"],
        });
    });

    it("requires nothing from an installation that has no consumer", () => {
        expect(projectGitHubAppInstallationRequirementsV1({
            purposes: [],
            permissions: {},
            events: [],
        })).toEqual({ permissions: {}, events: [], missingPermissions: [], missingEvents: [] });
    });
});
