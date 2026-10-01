import { describe, expect, it } from "vitest";

import { inferTailscaleServePublicServerUrl } from "./tailscaleServePublicUrlInference";

describe("inferTailscaleServePublicServerUrl", () => {
    it("returns the inferred address without writing it into the environment", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };
        const applied = await inferTailscaleServePublicServerUrl(env, {
            runTailscaleServeStatus: async () =>
                [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:3005",
                    "",
                ].join("\n"),
        });
        expect(applied).toBe("https://my-machine.tailnet.ts.net");
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("fails closed when tailscale serve status throws", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };
        const applied = await inferTailscaleServePublicServerUrl(env, {
            runTailscaleServeStatus: async () => {
                throw new Error("tailscale unavailable");
            },
        });
        expect(applied).toBeNull();
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("uses the default status timeout when the env value is out of range", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
            HAPPIER_TAILSCALE_SERVE_STATUS_TIMEOUT_MS: "20000",
        };

        let receivedTimeoutMs: number | null = null;
        const applied = await inferTailscaleServePublicServerUrl(env, {
            runTailscaleServeStatus: async ({ timeoutMs }) => {
                receivedTimeoutMs = timeoutMs;
                return [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:3005",
                    "",
                ].join("\n");
            },
        });

        expect(receivedTimeoutMs).toBe(750);
        expect(applied).toBe("https://my-machine.tailnet.ts.net");
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("fails closed when the proxy port does not match", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };
        const applied = await inferTailscaleServePublicServerUrl(env, {
            runTailscaleServeStatus: async () =>
                [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:9999",
                    "",
                ].join("\n"),
        });
        expect(applied).toBeNull();
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("respects HAPPIER_TAILSCALE_INFER_PUBLIC_URL=0", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "0",
        };
        const applied = await inferTailscaleServePublicServerUrl(env, {
            runTailscaleServeStatus: async () =>
                [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:3005",
                    "",
                ].join("\n"),
        });
        expect(applied).toBeNull();
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });
});
