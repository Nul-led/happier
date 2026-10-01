import { tailscaleServeHttpsUrlForInternalServerUrlFromStatus } from "@happier-dev/cli-common/tailscale";

import { parseIntEnv } from "@/config/env";

function resolveApiPort(env: NodeJS.ProcessEnv): number {
    const raw = String(env.PORT ?? "").trim();
    return parseIntEnv(raw, 3005, { min: 1, max: 65_535 });
}

function resolveInternalServerUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
}

/** The HTTPS address Tailscale serves this server's port on, read from a status report; never writes env. */
export function inferPublicServerUrlFromTailscaleStatus(
    env: NodeJS.ProcessEnv,
    statusText: string,
): string | null {
    return tailscaleServeHttpsUrlForInternalServerUrlFromStatus(
        statusText,
        resolveInternalServerUrl(resolveApiPort(env)),
    ) ?? null;
}
