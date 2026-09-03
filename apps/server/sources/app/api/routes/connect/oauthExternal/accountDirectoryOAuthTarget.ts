import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import {
    normalizeHttpUrl,
    resolveConfiguredCanonicalServerUrl,
    resolveConfiguredPublicServerUrl,
} from "@/app/serverUrls/effectiveServerUrls";

export type AccountDirectoryOAuthTarget = Readonly<{
    endpointUrl: string;
    endpointServerIdentityId: string;
    canonicalServerUrl: string;
}>;

export async function resolveCurrentAccountDirectoryOAuthTarget(
    env: NodeJS.ProcessEnv = process.env,
): Promise<AccountDirectoryOAuthTarget | null> {
    const endpointUrl = resolveConfiguredPublicServerUrl(env);
    const canonicalServerUrl = resolveConfiguredCanonicalServerUrl(env);
    if (!endpointUrl || !canonicalServerUrl) return null;

    try {
        const endpointServerIdentityId =
            await getOrCreateServerIdentityId(env);
        return {
            endpointUrl,
            endpointServerIdentityId,
            canonicalServerUrl,
        };
    } catch {
        return null;
    }
}

export async function isCurrentAccountDirectoryOAuthTarget(
    target: unknown,
    env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
    if (!target || typeof target !== "object") return false;
    const row = target as Readonly<Record<string, unknown>>;
    const endpointUrl = normalizeHttpUrl(String(row.endpointUrl ?? ""));
    const endpointServerIdentityId =
        typeof row.endpointServerIdentityId === "string"
            ? row.endpointServerIdentityId.trim()
            : "";
    const canonicalServerUrl = normalizeHttpUrl(
        String(row.canonicalServerUrl ?? ""),
    );
    if (!endpointUrl || !endpointServerIdentityId || !canonicalServerUrl) {
        return false;
    }

    const current = await resolveCurrentAccountDirectoryOAuthTarget(env);
    return current !== null
        && current.endpointUrl === endpointUrl
        && current.endpointServerIdentityId === endpointServerIdentityId
        && current.canonicalServerUrl === canonicalServerUrl;
}
