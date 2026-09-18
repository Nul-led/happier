import { z } from "zod";
import { computeCanonicalDomainSeparatedDigest } from "@happier-dev/protocol/crypto/canonicalDigest";

const ExactExternalIdSchema = z.string().min(1).max(512);
const TeamDirectoryBindingConfigV1Schema = z.discriminatedUnion("kind", [
    z.object({
        v: z.literal(1),
        kind: z.literal("workos_directory"),
        workosDirectoryId: z.string().min(1).max(256),
    }).strict(),
    z.object({
        v: z.literal(1),
        kind: z.literal("github_organization"),
        githubOrganizationLogin: z.string().trim().min(1).max(256),
    }).strict(),
]);

export type TeamDirectoryBindingConfigV1 = z.infer<typeof TeamDirectoryBindingConfigV1Schema>;

export function parseTeamDirectoryBindingConfigV1(value: unknown): TeamDirectoryBindingConfigV1 {
    return TeamDirectoryBindingConfigV1Schema.parse(value);
}

function deriveExternalSourceKey(kind: TeamDirectoryBindingConfigV1["kind"], parts: readonly string[]): string {
    for (const part of parts) ExactExternalIdSchema.parse(part);
    return `${kind}:${computeCanonicalDomainSeparatedDigest(`happier.${kind}.source.v1`, parts)}`;
}

export function deriveWorkosDirectoryExternalSourceKey(params: Readonly<{
    organizationId: string;
    directoryId: string;
}>): string {
    return deriveExternalSourceKey("workos_directory", [params.organizationId, params.directoryId]);
}

export function deriveGithubDirectoryExternalSourceKey(params: Readonly<{
    registrationId: string;
    installationId: bigint;
    organizationId: bigint;
}>): string {
    return deriveExternalSourceKey("github_organization", [
        params.registrationId,
        params.installationId.toString(),
        params.organizationId.toString(),
    ]);
}
