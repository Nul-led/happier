import {
    resolveRelayAccessConfiguredPublicAccess,
    type RelayAccessConfiguredPublicAccess,
} from "@happier-dev/cli-common/relayAccess";
import { resolveHappyHomeDirFromEnvironment } from "@happier-dev/cli-common/agents";
import { inferTailscaleServePublicServerUrl } from "@/app/integrations/tailscale/tailscaleServePublicUrlInference";
import { inferTailscaleFunnelPublicServerUrl } from "@/app/integrations/tailscale/tailscaleFunnelPublicUrlInference";
import { parseBooleanEnv, parseIntEnv } from "@/config/env";
import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The public address inferred on the computer that runs this server (plan
 * `2026-09-26-home-owner-console` §3.2): the relay-access method configured here, else Tailscale
 * Serve, else Tailscale Funnel pointing at this server's port.
 *
 * Inference is a read-only source. It never writes the environment; the configuration overlay
 * places an inferred value after the deployment env and the owner's stored address and stamps it
 * `inferred`, so it can never become the sign-in audience or pass for a setting (invariants I1, I2).
 * Results are cached per process with the configured time to live and refreshed when the
 * relay-access file changes; request paths only peek at the cache and refresh it in the background.
 */
export type InferredPublicServerUrlSource = "relay_access" | "tailscale_serve" | "tailscale_funnel";

export type InferredPublicServerUrl = Readonly<{
    url: string;
    source: InferredPublicServerUrlSource;
}>;

export type InferredPublicServerAccess = Readonly<{
    inferred: InferredPublicServerUrl | null;
    /** The relay-access configuration on this computer, when one exists. */
    relayAccess: RelayAccessConfiguredPublicAccess | null;
}>;

type InferenceCacheState = {
    value: InferredPublicServerAccess | null;
    resolved: boolean;
    expiresAtMs: number;
    relayAccessMtimeMs: number | null;
    inflight: Promise<InferredPublicServerAccess> | null;
};

const cache: InferenceCacheState = {
    value: null,
    resolved: false,
    expiresAtMs: 0,
    relayAccessMtimeMs: null,
    inflight: null,
};

const NOTHING_INFERRED: InferredPublicServerAccess = Object.freeze({ inferred: null, relayAccess: null });

function normalizeHttpUrl(raw: unknown): string | null {
    const value = String(raw ?? "").trim();
    if (!value) return null;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) {
        parsed.username = "";
        parsed.password = "";
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
}

function resolveCacheTtlMs(env: NodeJS.ProcessEnv): number {
    const raw = String(env.HAPPIER_PUBLIC_SERVER_URL_INFER_TTL_MS ?? "").trim();
    return parseIntEnv(raw, 60_000, { min: 1_000, max: 3_600_000 });
}

function resolveInternalServerUrl(env: NodeJS.ProcessEnv): string {
    const rawPort = String(env.PORT ?? "").trim();
    const port = parseIntEnv(rawPort, 3005, { min: 1, max: 65_535 });
    return `http://127.0.0.1:${port}`;
}

function shouldInferFromRelayAccessConfig(env: NodeJS.ProcessEnv): boolean {
    return parseBooleanEnv(env.HAPPIER_RELAY_ACCESS_INFER_PUBLIC_URL, true);
}

async function readRelayAccessConfigMtimeMs(env: NodeJS.ProcessEnv): Promise<number | null> {
    if (!shouldInferFromRelayAccessConfig(env)) return null;
    const happyHomeDir = resolveHappyHomeDirFromEnvironment(env);
    const path = join(happyHomeDir, "relay", "access", "local.json");
    const st = await stat(path).catch(() => null);
    if (!st) return null;
    return typeof st.mtimeMs === "number" ? st.mtimeMs : null;
}

async function probePublicServerAccess(env: NodeJS.ProcessEnv): Promise<InferredPublicServerAccess> {
    const relayAccess = shouldInferFromRelayAccessConfig(env)
        ? await resolveRelayAccessConfiguredPublicAccess(env, { upstreamUrl: resolveInternalServerUrl(env) })
            .catch(() => null)
        : null;
    const relayAccessUrl = normalizeHttpUrl(relayAccess?.shareUrl);
    if (relayAccessUrl) return { inferred: { url: relayAccessUrl, source: "relay_access" }, relayAccess };

    const serveUrl = normalizeHttpUrl(await inferTailscaleServePublicServerUrl(env));
    if (serveUrl) return { inferred: { url: serveUrl, source: "tailscale_serve" }, relayAccess };
    const funnelUrl = normalizeHttpUrl(await inferTailscaleFunnelPublicServerUrl(env));
    if (funnelUrl) return { inferred: { url: funnelUrl, source: "tailscale_funnel" }, relayAccess };
    return { inferred: null, relayAccess };
}

/** Starts (or joins) the one in-flight probe; `cache.inflight` is set synchronously. */
function refresh(
    env: NodeJS.ProcessEnv,
    readMtimeMs: () => Promise<number | null>,
): Promise<InferredPublicServerAccess> {
    if (cache.inflight) return cache.inflight;
    const inflight: Promise<InferredPublicServerAccess> = (async () => {
        const relayAccessMtimeMs = await readMtimeMs().catch(() => null);
        const value = await probePublicServerAccess(env).catch(() => cache.value ?? NOTHING_INFERRED);
        cache.value = value;
        cache.resolved = true;
        cache.expiresAtMs = Date.now() + resolveCacheTtlMs(env);
        cache.relayAccessMtimeMs = relayAccessMtimeMs;
        return value;
    })().finally(() => {
        if (cache.inflight === inflight) cache.inflight = null;
    });
    cache.inflight = inflight;
    return inflight;
}

/**
 * Resolves what this computer can say about its public address, probing when the cache is cold,
 * expired, or the relay-access configuration changed. Single-flight. For callers that can wait
 * (startup, the Home console's reachability read).
 */
export async function resolveInferredPublicServerAccess(env: NodeJS.ProcessEnv): Promise<InferredPublicServerAccess> {
    const relayAccessMtimeMs = await readRelayAccessConfigMtimeMs(env);
    const relayAccessChanged = relayAccessMtimeMs !== cache.relayAccessMtimeMs;
    if (cache.resolved && cache.value && !relayAccessChanged && Date.now() < cache.expiresAtMs) {
        return cache.value;
    }
    return await refresh(env, async () => relayAccessMtimeMs);
}

export async function resolveInferredPublicServerUrl(env: NodeJS.ProcessEnv): Promise<InferredPublicServerUrl | null> {
    return (await resolveInferredPublicServerAccess(env)).inferred;
}

/**
 * The hot-path read: the last inferred address, never waiting. A cold or expired cache starts one
 * background refresh; until it lands the caller sees the previous answer (or nothing yet).
 */
export function peekInferredPublicServerUrl(env: NodeJS.ProcessEnv): InferredPublicServerUrl | null {
    if (!cache.resolved || Date.now() >= cache.expiresAtMs) {
        void refresh(env, () => readRelayAccessConfigMtimeMs(env)).catch(() => undefined);
    }
    return cache.value?.inferred ?? null;
}

/** The last resolved inference facts, without probing. */
export function readInferredPublicServerAccess(): InferredPublicServerAccess | null {
    return cache.resolved ? cache.value : null;
}

export function resetPublicServerUrlInferenceCacheForTests(): void {
    cache.value = null;
    cache.resolved = false;
    cache.expiresAtMs = 0;
    cache.relayAccessMtimeMs = null;
    cache.inflight = null;
}

function readSingleHeaderValue(headers: Record<string, unknown>, name: string): string {
    const raw = (headers as any)[name] ?? (headers as any)[name.toLowerCase()] ?? (headers as any)[name.toUpperCase()];
    if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : "";
    return typeof raw === "string" ? raw : "";
}

function readForwardedListHeader(headers: Record<string, unknown>, name: string): string {
    const raw = readSingleHeaderValue(headers, name).trim();
    if (!raw) return "";
    const first = raw.split(",")[0] ?? "";
    return first.trim();
}

function resolveRequestProtocol(request: Readonly<{ protocol?: unknown; headers: Record<string, unknown> }>): string {
    const fromRequest = typeof request.protocol === "string" ? request.protocol.trim() : "";
    if (fromRequest) return fromRequest;
    const forwarded = readForwardedListHeader(request.headers, "x-forwarded-proto");
    return forwarded || "http";
}

function resolveRequestHost(request: Readonly<{ hostname?: unknown; headers: Record<string, unknown> }>): string {
    const fromRequest = typeof request.hostname === "string" ? request.hostname.trim() : "";
    if (fromRequest) return fromRequest;
    const forwarded = readForwardedListHeader(request.headers, "x-forwarded-host");
    if (forwarded) return forwarded;
    return readForwardedListHeader(request.headers, "host");
}

function normalizeHostForComparison(raw: string): Readonly<{ hostname: string; port: string | null }> | null {
    const value = raw.trim();
    if (!value) return null;
    try {
        const url = new URL(value.includes("://") ? value : `http://${value}`);
        const hostname = url.hostname.trim().toLowerCase();
        if (!hostname) return null;
        const port = url.port ? url.port.trim() : null;
        return { hostname, port: port || null };
    } catch {
        return null;
    }
}

export function isRequestOnPublicServerUrl(params: Readonly<{
    request: Readonly<{ headers: Record<string, unknown>; hostname?: unknown; protocol?: unknown }>;
    canonicalPublicServerUrl: string | null;
}>): boolean {
    if (!params.canonicalPublicServerUrl) return false;
    const canonical = normalizeHostForComparison(params.canonicalPublicServerUrl);
    if (!canonical) return false;

    const proto = resolveRequestProtocol(params.request).toLowerCase();
    if (proto !== "http" && proto !== "https") return false;

    const host = resolveRequestHost(params.request);
    const requestHost = normalizeHostForComparison(host);
    if (!requestHost) return false;

    if (canonical.hostname !== requestHost.hostname) return false;
    // Only enforce a port match when one side declares it. (Most public URLs will omit default ports.)
    if (canonical.port && requestHost.port && canonical.port !== requestHost.port) return false;
    return true;
}
