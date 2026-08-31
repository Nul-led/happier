export type TerminalAuthRequestPolicy = Readonly<{
    ttlMs: number;
}>;

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function resolveTerminalAuthRequestPolicyFromEnv(env: NodeJS.ProcessEnv): TerminalAuthRequestPolicy {
    const ttlSecondsRaw = Number(env.TERMINAL_AUTH_REQUEST_TTL_SECONDS ?? "");
    const ttlSecondsCandidate = Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0 ? ttlSecondsRaw : 900;
    const ttlSeconds = clampNumber(ttlSecondsCandidate, 60, 3600);
    const ttlMs = Math.floor(ttlSeconds * 1000);

    return { ttlMs };
}
