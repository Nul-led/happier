import { z } from "zod";

import { decryptString, encryptString } from "@/modules/encrypt";

const GitHubAppRegistrationConfigV1Schema = z.object({
    v: z.literal(1),
    secretHealth: z.object({
        clientSecretConfigured: z.boolean(),
        privateKeyConfigured: z.boolean(),
        webhookSecretConfigured: z.boolean(),
    }).strict().optional(),
}).strict();

export type GitHubAppRegistrationConfigV1 = z.infer<typeof GitHubAppRegistrationConfigV1Schema>;

export function parseGitHubAppRegistrationConfigV1(value: unknown): GitHubAppRegistrationConfigV1 {
    return GitHubAppRegistrationConfigV1Schema.parse(value);
}

const GitHubAppRegistrationSecretsV1Schema = z.object({
    v: z.literal(1),
    clientSecret: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    webhookSecret: z.string().min(1).optional(),
}).strict();

export type GitHubAppRegistrationSecretsV1 = z.infer<typeof GitHubAppRegistrationSecretsV1Schema>;

export type GitHubAppRegistrationSecretReplacementV1 = Readonly<{
    clientSecret?: string | null;
    privateKey?: string | null;
    webhookSecret?: string | null;
}>;

export function createGitHubAppRegistrationConfigV1(
    secrets: GitHubAppRegistrationSecretsV1,
): GitHubAppRegistrationConfigV1 {
    return GitHubAppRegistrationConfigV1Schema.parse({
        v: 1,
        secretHealth: projectGitHubAppSecretHealthV1(secrets),
    });
}

export function githubAppRegistrationSecretEncryptionPathV1(registrationId: string): string[] {
    return [
        "storage",
        "github_app_registration",
        registrationId,
        "secrets",
        "v1",
    ];
}

export function encryptGitHubAppRegistrationSecretsV1(params: Readonly<{
    registrationId: string;
    secrets: GitHubAppRegistrationSecretsV1;
}>): Uint8Array<ArrayBuffer> {
    const secrets = GitHubAppRegistrationSecretsV1Schema.parse(params.secrets);
    return encryptString(
        githubAppRegistrationSecretEncryptionPathV1(params.registrationId),
        JSON.stringify(secrets),
    );
}

export function decryptGitHubAppRegistrationSecretsV1(params: Readonly<{
    registrationId: string;
    encryptedSecrets: Uint8Array<ArrayBuffer>;
}>): GitHubAppRegistrationSecretsV1 {
    const plaintext = decryptString(
        githubAppRegistrationSecretEncryptionPathV1(params.registrationId),
        params.encryptedSecrets,
    );
    return GitHubAppRegistrationSecretsV1Schema.parse(JSON.parse(plaintext));
}

export function applyGitHubAppSecretReplacementV1(
    current: GitHubAppRegistrationSecretsV1,
    replacement: GitHubAppRegistrationSecretReplacementV1,
): GitHubAppRegistrationSecretsV1 {
    const parsedCurrent = GitHubAppRegistrationSecretsV1Schema.parse(current);
    const next: GitHubAppRegistrationSecretsV1 = {
        v: 1,
        ...(replacement.clientSecret === undefined
            ? parsedCurrent.clientSecret === undefined ? {} : { clientSecret: parsedCurrent.clientSecret }
            : replacement.clientSecret === null ? {} : { clientSecret: replacement.clientSecret }),
        ...(replacement.privateKey === undefined
            ? parsedCurrent.privateKey === undefined ? {} : { privateKey: parsedCurrent.privateKey }
            : replacement.privateKey === null ? {} : { privateKey: replacement.privateKey }),
        ...(replacement.webhookSecret === undefined
            ? parsedCurrent.webhookSecret === undefined ? {} : { webhookSecret: parsedCurrent.webhookSecret }
            : replacement.webhookSecret === null ? {} : { webhookSecret: replacement.webhookSecret }),
    };
    return GitHubAppRegistrationSecretsV1Schema.parse(next);
}

export type GitHubAppSecretHealthV1 = Readonly<{
    clientSecretConfigured: boolean;
    privateKeyConfigured: boolean;
    webhookSecretConfigured: boolean;
}>;

export function projectGitHubAppSecretHealthV1(
    secrets: GitHubAppRegistrationSecretsV1,
): GitHubAppSecretHealthV1 {
    const parsed = GitHubAppRegistrationSecretsV1Schema.parse(secrets);
    return Object.freeze({
        clientSecretConfigured: parsed.clientSecret !== undefined,
        privateKeyConfigured: parsed.privateKey !== undefined,
        webhookSecretConfigured: parsed.webhookSecret !== undefined,
    });
}

const GitHubPermissionLevelV1Schema = z.enum(["read", "write"]);
const GitHubPermissionsV1Schema = z.record(
    z.string().min(1),
    GitHubPermissionLevelV1Schema,
);
export type GitHubPermissionsV1 = z.infer<typeof GitHubPermissionsV1Schema>;

export function parseGitHubPermissionsV1(value: unknown): GitHubPermissionsV1 {
    return GitHubPermissionsV1Schema.parse(value);
}
const GitHubEventsV1Schema = z.array(z.string().min(1));
const GitHubRepositorySelectionV1Schema = z.enum(["all", "selected"]);

const GitHubAppInstallationEvidenceV1Schema = z.object({
    githubAppId: z.bigint().positive(),
    githubInstallationId: z.bigint().positive(),
    githubOrganizationId: z.bigint().positive(),
    githubOrganizationLogin: z.string().trim().min(1).max(256),
    suspended: z.boolean(),
    permissions: GitHubPermissionsV1Schema,
    events: GitHubEventsV1Schema,
    repositorySelection: GitHubRepositorySelectionV1Schema,
}).strict();

export type GitHubAppInstallationEvidenceV1 = z.infer<typeof GitHubAppInstallationEvidenceV1Schema>;

export type GitHubAppInstallationEvidenceResultV1 =
    | Readonly<{
        ok: true;
        value: Readonly<Omit<GitHubAppInstallationEvidenceV1,
            "githubAppId" | "githubInstallationId" | "githubOrganizationId">>;
    }>
    | Readonly<{
        ok: false;
        code:
            | "github_installation_evidence_invalid"
            | "github_app_mismatch"
            | "github_installation_mismatch"
            | "github_organization_mismatch"
            | "github_permission_missing";
        permission?: string;
    }>;

export function validateGitHubAppInstallationEvidenceV1(params: Readonly<{
    expected: Readonly<{
        githubAppId: bigint;
        githubInstallationId: bigint;
        githubOrganizationId: bigint;
        requiredPermissions?: Readonly<Record<string, "read" | "write">>;
    }>;
    observed: unknown;
}>): GitHubAppInstallationEvidenceResultV1 {
    const parsed = GitHubAppInstallationEvidenceV1Schema.safeParse(params.observed);
    if (!parsed.success) return { ok: false, code: "github_installation_evidence_invalid" };
    if (parsed.data.githubAppId !== params.expected.githubAppId) {
        return { ok: false, code: "github_app_mismatch" };
    }
    if (parsed.data.githubInstallationId !== params.expected.githubInstallationId) {
        return { ok: false, code: "github_installation_mismatch" };
    }
    if (parsed.data.githubOrganizationId !== params.expected.githubOrganizationId) {
        return { ok: false, code: "github_organization_mismatch" };
    }
    for (const [permission, required] of Object.entries(params.expected.requiredPermissions ?? {})) {
        if (!permissionSatisfies(parsed.data.permissions[permission], required)) {
            return { ok: false, code: "github_permission_missing", permission };
        }
    }
    return {
        ok: true,
        value: {
            githubOrganizationLogin: parsed.data.githubOrganizationLogin,
            suspended: parsed.data.suspended,
            permissions: parsed.data.permissions,
            events: parsed.data.events,
            repositorySelection: parsed.data.repositorySelection,
        },
    };
}

export type GitHubAppConsumerPurposeV1 =
    | Readonly<{ kind: "identity"; requiresOrganizationEvidence: boolean }>
    | Readonly<{ kind: "directorySync" }>
    | Readonly<{
        kind: "repository";
        requiredPermissions: Readonly<Record<string, "read" | "write">>;
        requiredEvents: readonly string[];
        requiresWebhookSecret: boolean;
    }>;

export type GitHubAppConsumerReadinessResultV1 =
    | Readonly<{ ok: true }>
    | Readonly<{
        ok: false;
        code:
            | "github_app_not_configured"
            | "github_installation_unverified"
            | "github_installation_suspended"
            | "github_permission_missing"
            | "github_event_missing"
            | "github_webhook_secret_missing";
        permission?: string;
        event?: string;
    }>;

function permissionSatisfies(
    actual: "read" | "write" | undefined,
    required: "read" | "write",
): boolean {
    return actual === "write" || actual === required;
}

export function resolveGitHubAppConsumerReadinessV1(input: Readonly<{
    purpose: GitHubAppConsumerPurposeV1;
    registration: Readonly<{
        state: string;
        secretHealth: GitHubAppSecretHealthV1;
    }>;
    installation: Readonly<{
        state: string;
        suspended: boolean;
        permissions: Readonly<Record<string, "read" | "write">>;
        events: readonly string[];
    }>;
}>): GitHubAppConsumerReadinessResultV1 {
    if (input.registration.state !== "verified") {
        return { ok: false, code: "github_app_not_configured" };
    }
    if (input.installation.state !== "verified") {
        return { ok: false, code: "github_installation_unverified" };
    }
    if (input.installation.suspended) {
        return { ok: false, code: "github_installation_suspended" };
    }

    const requirements = input.purpose.kind === "identity"
        ? {
            needsClientSecret: true,
            needsPrivateKey: input.purpose.requiresOrganizationEvidence,
            needsWebhookSecret: false,
            permissions: input.purpose.requiresOrganizationEvidence ? { members: "read" as const } : {},
            events: [] as readonly string[],
        }
        : input.purpose.kind === "directorySync"
            ? {
                needsClientSecret: false,
                needsPrivateKey: true,
                needsWebhookSecret: false,
                permissions: { members: "read" as const },
                events: [] as readonly string[],
            }
            : {
                needsClientSecret: false,
                needsPrivateKey: true,
                needsWebhookSecret: input.purpose.requiresWebhookSecret,
                permissions: input.purpose.requiredPermissions,
                events: input.purpose.requiredEvents,
            };

    if (requirements.needsClientSecret && !input.registration.secretHealth.clientSecretConfigured) {
        return { ok: false, code: "github_app_not_configured" };
    }
    if (requirements.needsPrivateKey && !input.registration.secretHealth.privateKeyConfigured) {
        return { ok: false, code: "github_app_not_configured" };
    }
    if (requirements.needsWebhookSecret && !input.registration.secretHealth.webhookSecretConfigured) {
        return { ok: false, code: "github_webhook_secret_missing" };
    }
    for (const [permission, required] of Object.entries(requirements.permissions)) {
        if (!permissionSatisfies(input.installation.permissions[permission], required)) {
            return { ok: false, code: "github_permission_missing", permission };
        }
    }
    const actualEvents = new Set(input.installation.events);
    for (const event of requirements.events) {
        if (!actualEvents.has(event)) return { ok: false, code: "github_event_missing", event };
    }
    return { ok: true };
}
