import { WorkOS } from "@workos-inc/node";
import { computeCanonicalDomainSeparatedDigest } from "@happier-dev/protocol/crypto/canonicalDigest";

export type WorkosPlatformUnavailableReason =
    | "not_configured"
    | "partial_configuration"
    | "invalid_configuration";

export type WorkosPlatformConfigResolution =
    | Readonly<{
        available: true;
        clientId: string;
        client: WorkOS;
        runtimeFingerprint: string;
    }>
    | Readonly<{
        available: false;
        code: "workos_platform_unavailable";
        reason: WorkosPlatformUnavailableReason;
    }>;

export type WorkosPlatformRuntimeMetadata =
    | Readonly<{
        available: true;
        clientId: string;
        runtimeFingerprint: string;
    }>
    | Extract<WorkosPlatformConfigResolution, { available: false }>;

type WorkosClientConfig = Readonly<{
    apiKey: string;
    clientId: string;
    timeout?: number;
    maxRetries?: number;
    fetchFn?: typeof fetch;
}>;
type WorkosClientFactory = (config: WorkosClientConfig) => WorkOS;

export type WorkosPlatformRequestPolicy = Readonly<{
    signal?: AbortSignal;
    timeoutMs: number;
    maxRetries: number;
}>;

export const WORKOS_INTERACTIVE_REQUEST_TIMEOUT_MS = 30_000;
export const WORKOS_REQUEST_MAX_RETRIES = 2;

export function resolveWorkosPlatformRequestPolicy(
    input: Readonly<{ signal?: AbortSignal }> = {},
): WorkosPlatformRequestPolicy {
    return Object.freeze({
        timeoutMs: WORKOS_INTERACTIVE_REQUEST_TIMEOUT_MS,
        maxRetries: WORKOS_REQUEST_MAX_RETRIES,
        ...(input.signal ? { signal: input.signal } : {}),
    });
}

const createSdkClient: WorkosClientFactory = (config) => new WorkOS(config);

function createRequestFetch(
    callerSignal: AbortSignal | undefined,
    upstreamFetch: typeof fetch,
): typeof fetch {
    return async (input, init) => {
        const requestSignal = init?.signal ?? undefined;
        const signal = callerSignal && requestSignal
            ? AbortSignal.any([callerSignal, requestSignal])
            : callerSignal ?? requestSignal;
        return await upstreamFetch(input, {
            ...init,
            ...(signal ? { signal } : {}),
        });
    };
}

function readWorkosPlatformCredentials(env: NodeJS.ProcessEnv): Readonly<{
    apiKey: string;
    clientId: string;
}> {
    return {
        apiKey: env.WORKOS_API_KEY?.toString().trim() ?? "",
        clientId: env.WORKOS_CLIENT_ID?.toString().trim() ?? "",
    };
}

/** Safe runtime identity for descriptor/catalog reads; constructs no SDK client. */
export function resolveWorkosPlatformRuntimeMetadata(
    env: NodeJS.ProcessEnv,
): WorkosPlatformRuntimeMetadata {
    const { apiKey, clientId } = readWorkosPlatformCredentials(env);
    if (!apiKey && !clientId) {
        return Object.freeze({
            available: false,
            code: "workos_platform_unavailable",
            reason: "not_configured",
        });
    }
    if (!apiKey || !clientId) {
        return Object.freeze({
            available: false,
            code: "workos_platform_unavailable",
            reason: "partial_configuration",
        });
    }
    return Object.freeze({
        available: true,
        clientId,
        runtimeFingerprint: `workos-platform:v1:${computeCanonicalDomainSeparatedDigest(
            "happier.workos-platform.runtime.v1",
            [apiKey, clientId],
        )}`,
    });
}

export function resolveWorkosPlatformConfig(
    env: NodeJS.ProcessEnv,
    dependencies: Readonly<{ createClient?: WorkosClientFactory; fetchFn?: typeof fetch }> = {},
    requestPolicy: WorkosPlatformRequestPolicy = resolveWorkosPlatformRequestPolicy(),
): WorkosPlatformConfigResolution {
    const credentials = readWorkosPlatformCredentials(env);
    const metadata = resolveWorkosPlatformRuntimeMetadata(env);
    if (!metadata.available) return metadata;

    try {
        const client = (dependencies.createClient ?? createSdkClient)({
            ...credentials,
            timeout: requestPolicy.timeoutMs,
            maxRetries: requestPolicy.maxRetries,
            fetchFn: createRequestFetch(
                requestPolicy.signal,
                dependencies.fetchFn ?? globalThis.fetch,
            ),
        });
        return Object.freeze({ ...metadata, client });
    } catch {
        return Object.freeze({
            available: false,
            code: "workos_platform_unavailable",
            reason: "invalid_configuration",
        });
    }
}
