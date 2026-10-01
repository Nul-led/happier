import { describe, expect, it } from "vitest";

import { inferTailscaleFunnelPublicServerUrl } from "./tailscaleFunnelPublicUrlInference";

describe("inferTailscaleFunnelPublicServerUrl", () => {
    it("returns the inferred address without writing it into the environment", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };

        const applied = await inferTailscaleFunnelPublicServerUrl(env, {
            runTailscaleFunnelStatus: async () =>
                [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:3005",
                    "",
                ].join("\n"),
        });

        expect(applied).toBe("https://my-machine.tailnet.ts.net");
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("fails closed when tailscale funnel status throws", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };

        const applied = await inferTailscaleFunnelPublicServerUrl(env, {
            runTailscaleFunnelStatus: async () => {
                throw new Error("tailscale unavailable");
            },
        });

        expect(applied).toBeNull();
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

    it("fails closed when the proxy port does not match", async () => {
        const env: Record<string, string | undefined> = {
            PORT: "3005",
            HAPPIER_PUBLIC_SERVER_URL: "",
            HAPPIER_TAILSCALE_INFER_PUBLIC_URL: "1",
        };

        const applied = await inferTailscaleFunnelPublicServerUrl(env, {
            runTailscaleFunnelStatus: async () =>
                [
                    "https://my-machine.tailnet.ts.net",
                    "|-- / proxy http://127.0.0.1:9999",
                    "",
                ].join("\n"),
        });

        expect(applied).toBeNull();
        expect(env.HAPPIER_PUBLIC_SERVER_URL).toBe("");
    });

});
