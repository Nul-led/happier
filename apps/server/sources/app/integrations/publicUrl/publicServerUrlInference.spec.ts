import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    isRequestOnPublicServerUrl,
    resolveCachedPublicServerUrl,
    readPublicServerUrlFromEnv,
    resetPublicServerUrlInferenceCacheForTests,
} from "./publicServerUrlInference";

vi.mock("@/app/integrations/tailscale/tailscaleServePublicUrlInference", () => ({
    inferAndApplyTailscaleServePublicServerUrl: vi.fn(),
}));

vi.mock("@/app/integrations/tailscale/tailscaleFunnelPublicUrlInference", () => ({
    inferAndApplyTailscaleFunnelPublicServerUrl: vi.fn(),
}));

describe("publicServerUrlInference", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        resetPublicServerUrlInferenceCacheForTests();
    });

    describe("resolveCachedPublicServerUrl", () => {
        it("infers the canonical public URL from the persisted relay access config (cloudflareNamed)", async () => {
            const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const homeDir = await mkdtemp(join(tmpdir(), "happier-public-url-"));
            const previousHome = process.env.HOME;
            process.env.HOME = homeDir;
            try {
                await mkdir(join(homeDir, ".happier", "relay", "access"), { recursive: true });
                await writeFile(
                    join(homeDir, ".happier", "relay", "access", "local.json"),
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay.example.test", token: "secret" }),
                    "utf8",
                );

                const env = {
                    HOME: homeDir,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                } as NodeJS.ProcessEnv;
                resetPublicServerUrlInferenceCacheForTests();
                const resolved = await resolveCachedPublicServerUrl(env);
                expect(resolved).toBe("https://relay.example.test");
            } finally {
                process.env.HOME = previousHome;
                await rm(homeDir, { recursive: true, force: true });
            }
        });

        it("does not infer from relay access config when HAPPIER_RELAY_ACCESS_INFER_PUBLIC_URL=0", async () => {
            const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const homeDir = await mkdtemp(join(tmpdir(), "happier-public-url-"));
            const previousHome = process.env.HOME;
            process.env.HOME = homeDir;
            try {
                await mkdir(join(homeDir, ".happier", "relay", "access"), { recursive: true });
                await writeFile(
                    join(homeDir, ".happier", "relay", "access", "local.json"),
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay.example.test", token: "secret" }),
                    "utf8",
                );

                const env = {
                    HOME: homeDir,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                    HAPPIER_RELAY_ACCESS_INFER_PUBLIC_URL: "0",
                } as NodeJS.ProcessEnv;
                resetPublicServerUrlInferenceCacheForTests();
                const resolved = await resolveCachedPublicServerUrl(env);
                expect(resolved).toBeNull();
            } finally {
                process.env.HOME = previousHome;
                await rm(homeDir, { recursive: true, force: true });
            }
        });

        it("infers the canonical public URL from persisted relay access tailscaleFunnel config when the current port matches", async () => {
            const { chmod, mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const homeDir = await mkdtemp(join(tmpdir(), "happier-public-url-"));
            const binDir = await mkdtemp(join(tmpdir(), "happier-public-url-bin-"));
            const previousHome = process.env.HOME;
            process.env.HOME = homeDir;
            try {
                const tailscaleBin = join(binDir, "tailscale");
                await writeFile(
                    tailscaleBin,
                    [
                        "#!/usr/bin/env bash",
                        "set -euo pipefail",
                        'if [[ "${1:-}" == "status" && "${2:-}" == "--json" ]]; then',
                        "  cat <<'JSON'",
                        '{"BackendState":"Running","HaveNodeKey":true,"Self":{"DNSName":"my-machine.tailnet.ts.net"}}',
                        "JSON",
                        "  exit 0",
                        "fi",
                        'if [[ "${1:-}" == "funnel" && "${2:-}" == "status" ]]; then',
                        "  cat <<'TXT'",
                        "https://funnel.example.test",
                        "|-- / proxy http://127.0.0.1:3005",
                        "TXT",
                        "  exit 0",
                        "fi",
                        "echo \"unexpected args: $*\" >&2",
                        "exit 1",
                        "",
                    ].join("\n"),
                    "utf8",
                );
                await chmod(tailscaleBin, 0o755);
                await mkdir(join(homeDir, ".happier", "relay", "access"), { recursive: true });
                await writeFile(
                    join(homeDir, ".happier", "relay", "access", "local.json"),
                    JSON.stringify({ providerId: "tailscaleFunnel" }),
                    "utf8",
                );

                const env = {
                    HOME: homeDir,
                    HAPPIER_TAILSCALE_BIN: tailscaleBin,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                    HAPPIER_RELAY_ACCESS_INFER_PUBLIC_URL: "1",
                } as NodeJS.ProcessEnv;
                resetPublicServerUrlInferenceCacheForTests();
                const resolved = await resolveCachedPublicServerUrl(env);
                expect(resolved).toBe("https://funnel.example.test");
            } finally {
                process.env.HOME = previousHome;
                await rm(homeDir, { recursive: true, force: true });
                await rm(binDir, { recursive: true, force: true });
            }
        });

        it("falls back to tailscale funnel inference after serve inference returns null", async () => {
            const { inferAndApplyTailscaleServePublicServerUrl } = await import("@/app/integrations/tailscale/tailscaleServePublicUrlInference");
            const { inferAndApplyTailscaleFunnelPublicServerUrl } = await import("@/app/integrations/tailscale/tailscaleFunnelPublicUrlInference");

            vi.mocked(inferAndApplyTailscaleServePublicServerUrl).mockImplementation(async () => null);
            vi.mocked(inferAndApplyTailscaleFunnelPublicServerUrl).mockImplementation(async (env) => {
                env.HAPPIER_PUBLIC_SERVER_URL = "https://funnel.example.test";
                return "https://funnel.example.test";
            });

            const env = {
                HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
                HAPPIER_PUBLIC_SERVER_URL: "",
                HAPPIER_PUBLIC_SERVER_URL_INFER_TTL_MS: "60000",
            } as NodeJS.ProcessEnv;

            resetPublicServerUrlInferenceCacheForTests();
            const resolved = await resolveCachedPublicServerUrl(env);

            expect(resolved).toBe("https://funnel.example.test");
            expect(inferAndApplyTailscaleServePublicServerUrl).toHaveBeenCalledTimes(1);
            expect(inferAndApplyTailscaleFunnelPublicServerUrl).toHaveBeenCalledTimes(1);
        });

        it("invalidates the cache when a relay access config appears after a null inference", async () => {
            const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const homeDir = await mkdtemp(join(tmpdir(), "happier-public-url-"));
            const previousHome = process.env.HOME;
            process.env.HOME = homeDir;
            try {
                const accessDir = join(homeDir, ".happier", "relay", "access");
                const accessPath = join(accessDir, "local.json");

                const env = {
                    HOME: homeDir,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                    HAPPIER_PUBLIC_SERVER_URL_INFER_TTL_MS: "60000",
                } as NodeJS.ProcessEnv;

                resetPublicServerUrlInferenceCacheForTests();
                const resolved1 = await resolveCachedPublicServerUrl(env);
                expect(resolved1).toBeNull();

                await mkdir(accessDir, { recursive: true });
                await writeFile(
                    accessPath,
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay.example.test", token: "secret" }),
                    "utf8",
                );

                const resolved2 = await resolveCachedPublicServerUrl(env);
                expect(resolved2).toBe("https://relay.example.test");
            } finally {
                process.env.HOME = previousHome;
                await rm(homeDir, { recursive: true, force: true });
            }
        });

        it("invalidates the cache when relay access config appears under HAPPIER_HOME_DIR", async () => {
            const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const happyHomeDir = await mkdtemp(join(tmpdir(), "happier-home-dir-"));
            try {
                const accessDir = join(happyHomeDir, "relay", "access");
                const accessPath = join(accessDir, "local.json");

                const env = {
                    HAPPIER_HOME_DIR: happyHomeDir,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                    HAPPIER_PUBLIC_SERVER_URL_INFER_TTL_MS: "60000",
                } as NodeJS.ProcessEnv;

                resetPublicServerUrlInferenceCacheForTests();
                const resolved1 = await resolveCachedPublicServerUrl(env);
                expect(resolved1).toBeNull();

                await mkdir(accessDir, { recursive: true });
                await writeFile(
                    accessPath,
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay.example.test", token: "secret" }),
                    "utf8",
                );

                const resolved2 = await resolveCachedPublicServerUrl(env);
                expect(resolved2).toBe("https://relay.example.test");
            } finally {
                await rm(happyHomeDir, { recursive: true, force: true });
            }
        });

        it("re-infers after TTL when the persisted relay access config changes", async () => {
            vi.useFakeTimers();
            const now = new Date("2026-03-31T10:00:00.000Z");
            vi.setSystemTime(now);

            const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
            const { tmpdir } = await import("node:os");
            const { join } = await import("node:path");

            const homeDir = await mkdtemp(join(tmpdir(), "happier-public-url-"));
            const previousHome = process.env.HOME;
            process.env.HOME = homeDir;

            try {
                await mkdir(join(homeDir, ".happier", "relay", "access"), { recursive: true });
                const accessPath = join(homeDir, ".happier", "relay", "access", "local.json");
                await writeFile(
                    accessPath,
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay1.example.test", token: "secret" }),
                    "utf8",
                );

                const env = {
                    HOME: homeDir,
                    HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
                    HAPPIER_PUBLIC_SERVER_URL_INFER_TTL_MS: "1000",
                } as NodeJS.ProcessEnv;

                resetPublicServerUrlInferenceCacheForTests();
                const resolved1 = await resolveCachedPublicServerUrl(env);
                expect(resolved1).toBe("https://relay1.example.test");

                await writeFile(
                    accessPath,
                    JSON.stringify({ providerId: "cloudflareNamed", hostname: "relay2.example.test", token: "secret" }),
                    "utf8",
                );

                vi.setSystemTime(new Date(now.getTime() + 1_025));
                const resolved2 = await resolveCachedPublicServerUrl(env);
                expect(resolved2).toBe("https://relay2.example.test");
            } finally {
                vi.useRealTimers();
                process.env.HOME = previousHome;
                await rm(homeDir, { recursive: true, force: true });
            }
        });
    });

    describe("readPublicServerUrlFromEnv", () => {
        it("normalizes and strips userinfo/query/hash/trailing slash", () => {
            const env = {
                HAPPIER_PUBLIC_SERVER_URL: "https://user:pass@stack.example.test/?q=1#frag",
            } as NodeJS.ProcessEnv;

            expect(readPublicServerUrlFromEnv(env)).toBe("https://stack.example.test");
        });

        it("returns null when url is missing or invalid", () => {
            expect(readPublicServerUrlFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
            expect(readPublicServerUrlFromEnv({ HAPPIER_PUBLIC_SERVER_URL: "not-a-url" } as NodeJS.ProcessEnv)).toBeNull();
        });
    });

    describe("isRequestOnPublicServerUrl", () => {
        it("matches on host + protocol using direct request fields", () => {
            expect(
                isRequestOnPublicServerUrl({
                    canonicalPublicServerUrl: "https://public.example.test",
                    request: {
                        headers: {},
                        protocol: "https",
                        hostname: "public.example.test",
                    },
                }),
            ).toBe(true);
        });

        it("matches using x-forwarded-proto + x-forwarded-host when request fields are missing", () => {
            expect(
                isRequestOnPublicServerUrl({
                    canonicalPublicServerUrl: "https://public.example.test",
                    request: {
                        headers: {
                            "x-forwarded-proto": "https",
                            "x-forwarded-host": "public.example.test",
                        },
                    },
                }),
            ).toBe(true);
        });

        it("prefers x-forwarded-host over host and uses first forwarded entry", () => {
            expect(
                isRequestOnPublicServerUrl({
                    canonicalPublicServerUrl: "https://public.example.test",
                    request: {
                        headers: {
                            host: "wrong.example.test",
                            "x-forwarded-proto": "https",
                            "x-forwarded-host": "public.example.test, proxy.example.test",
                        },
                    },
                }),
            ).toBe(true);
        });

        it("returns false when hostname mismatches", () => {
            expect(
                isRequestOnPublicServerUrl({
                    canonicalPublicServerUrl: "https://public.example.test",
                    request: {
                        headers: { host: "other.example.test" },
                        protocol: "https",
                    },
                }),
            ).toBe(false);
        });
    });
});
