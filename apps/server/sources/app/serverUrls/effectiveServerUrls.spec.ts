import { describe, expect, it } from "vitest";

import {
    resolveConfiguredCanonicalServerUrl,
    resolveConfiguredPublicServerUrl,
    resolveDerivedLocalUiWebappUrl,
} from "./effectiveServerUrls";

describe("effective server URL ownership", () => {
    it("keeps canonical identity separate from configured public ingress", () => {
        const env = {
            HAPPIER_CANONICAL_SERVER_URL: "http://127.0.0.1:43123/",
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test/",
        } as NodeJS.ProcessEnv;

        expect(resolveConfiguredCanonicalServerUrl(env)).toBe("http://127.0.0.1:43123");
        expect(resolveConfiguredPublicServerUrl(env)).toBe("https://home.example.test");
    });

    it("uses only an explicitly configured historical public URL as the bounded canonical fallback", () => {
        expect(resolveConfiguredCanonicalServerUrl({
            HAPPIER_PUBLIC_SERVER_URL: "https://legacy.example.test/",
        } as NodeJS.ProcessEnv)).toBe("https://legacy.example.test");

        expect(resolveConfiguredCanonicalServerUrl({
            HAPPIER_PUBLIC_SERVER_URL: "https://inferred.example.test/",
            HAPPIER_PUBLIC_SERVER_URL_INFERRED: "1",
        } as NodeJS.ProcessEnv)).toBeUndefined();
    });

    it("derives a served UI URL from public ingress rather than canonical loopback identity", () => {
        const base = {
            HAPPIER_CANONICAL_SERVER_URL: "http://127.0.0.1:43123",
            HAPPIER_SERVER_UI_DIR: "/tmp/ui",
            HAPPIER_SERVER_UI_PREFIX: "/ui",
        } as NodeJS.ProcessEnv;

        expect(resolveDerivedLocalUiWebappUrl(base)).toBeUndefined();
        expect(resolveDerivedLocalUiWebappUrl({
            ...base,
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test/base",
        })).toBe("https://home.example.test/base/ui");
    });
});
