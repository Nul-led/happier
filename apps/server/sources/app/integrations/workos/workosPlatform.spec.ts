import type { WorkOS } from "@workos-inc/node";
import { describe, expect, it, vi } from "vitest";

import {
    resolveWorkosPlatformConfig,
    resolveWorkosPlatformRequestPolicy,
    resolveWorkosPlatformRuntimeMetadata,
} from "./workosPlatform";

describe("resolveWorkosPlatformConfig", () => {
    it.each([
        [{}, "not_configured"],
        [{ WORKOS_API_KEY: "sk_test_secret" }, "partial_configuration"],
        [{ WORKOS_CLIENT_ID: "client_test" }, "partial_configuration"],
        [{ WORKOS_API_KEY: "   ", WORKOS_CLIENT_ID: "client_test" }, "partial_configuration"],
    ] as const)("fails closed without constructing a client for incomplete config %#", (env, reason) => {
        const createClient = vi.fn();

        expect(resolveWorkosPlatformConfig(env, { createClient })).toEqual({
            available: false,
            code: "workos_platform_unavailable",
            reason,
        });
        expect(createClient).not.toHaveBeenCalled();
    });

    it("constructs one SDK client from trimmed Home-owned configuration", () => {
        const client = Object.freeze({}) as WorkOS;
        const createClient = vi.fn(() => client);

        const result = resolveWorkosPlatformConfig({
            WORKOS_API_KEY: "  sk_test_secret  ",
            WORKOS_CLIENT_ID: "  client_test  ",
        }, { createClient });

        expect(createClient).toHaveBeenCalledOnce();
        expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
            apiKey: "sk_test_secret",
            clientId: "client_test",
            timeout: 30_000,
            maxRetries: 2,
            fetchFn: expect.any(Function),
        }));
        expect(result).toEqual({
            available: true,
            clientId: "client_test",
            client,
            runtimeFingerprint: expect.stringMatching(/^workos-platform:v1:/),
        });
        expect(result).not.toHaveProperty("apiKey");
        const rotated = resolveWorkosPlatformConfig({
            WORKOS_API_KEY: "sk_test_rotated",
            WORKOS_CLIENT_ID: "client_test",
        }, { createClient });
        expect(rotated.available && result.available && rotated.runtimeFingerprint)
            .not.toBe(result.available && result.runtimeFingerprint);
    });

    it("constructs a request-scoped client with the directory timeout and caller cancellation", async () => {
        const upstream = vi.fn(async (_input: string | Request | URL, _init?: RequestInit) => new Response());
        const createClient = vi.fn((config: {
            apiKey: string;
            clientId: string;
            timeout?: number;
            maxRetries?: number;
            fetchFn?: typeof fetch;
        }) => Object.freeze({ config }) as unknown as WorkOS);
        const controller = new AbortController();

        resolveWorkosPlatformConfig({
            WORKOS_API_KEY: "sk_test_secret",
            WORKOS_CLIENT_ID: "client_test",
        }, {
            createClient,
            fetchFn: upstream,
        }, resolveWorkosPlatformRequestPolicy({ signal: controller.signal }));

        const config = createClient.mock.calls[0]?.[0];
        expect(config).toEqual(expect.objectContaining({ timeout: 30_000, maxRetries: 2 }));
        expect(config?.fetchFn).toBeTypeOf("function");
        controller.abort();
        await config?.fetchFn?.("https://example.com", {});
        expect(upstream).toHaveBeenCalledWith("https://example.com", expect.objectContaining({
            signal: expect.objectContaining({ aborted: true }),
        }));
    });

    it("projects the exact runtime fingerprint without constructing a WorkOS client", () => {
        const env = {
            WORKOS_API_KEY: "  sk_test_secret  ",
            WORKOS_CLIENT_ID: "  client_test  ",
        };
        const createClient = vi.fn(() => Object.freeze({}) as WorkOS);
        const runtime = resolveWorkosPlatformConfig(env, { createClient });

        expect(resolveWorkosPlatformRuntimeMetadata(env)).toEqual({
            available: true,
            clientId: "client_test",
            runtimeFingerprint: runtime.available ? runtime.runtimeFingerprint : "unreachable",
        });
        expect(createClient).toHaveBeenCalledOnce();
    });

    it("returns a secret-free typed diagnostic when SDK construction rejects the config", () => {
        const createClient = vi.fn(() => {
            throw new Error("contains-sensitive-input");
        });

        const result = resolveWorkosPlatformConfig({
            WORKOS_API_KEY: "sk_test_secret",
            WORKOS_CLIENT_ID: "client_test",
        }, { createClient });

        expect(result).toEqual({
            available: false,
            code: "workos_platform_unavailable",
            reason: "invalid_configuration",
        });
        expect(JSON.stringify(result)).not.toContain("sk_test_secret");
        expect(JSON.stringify(result)).not.toContain("contains-sensitive-input");
    });
});
