import { describe, expect, it } from "vitest";

import {
    resolveConfiguredCanonicalServerUrl,
    resolveConfiguredPublicServerUrl,
    resolveDerivedLocalUiWebappUrl,
} from "./effectiveServerUrls";
import { buildHomeConfigEnv } from "@/app/home/settings/homeConfigOverlay";

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

    });

    it("never lets a Home-stored or inferred public address become the sign-in audience (I1)", () => {
        const deployment = { HAPPIER_SERVER_UI_DIR: "/tmp/ui" } as NodeJS.ProcessEnv;
        const stored = buildHomeConfigEnv(deployment, { HAPPIER_PUBLIC_SERVER_URL: "https://stored.example.test" });
        expect(resolveConfiguredPublicServerUrl(stored)).toBe("https://stored.example.test");
        expect(resolveConfiguredCanonicalServerUrl(stored)).toBeUndefined();

        const inferred = buildHomeConfigEnv(deployment, {}, undefined, {}, {
            HAPPIER_PUBLIC_SERVER_URL: "https://inferred.example.test",
        });
        expect(resolveConfiguredPublicServerUrl(inferred)).toBe("https://inferred.example.test");
        expect(resolveConfiguredCanonicalServerUrl(inferred)).toBeUndefined();
        // A copy of the overlay keeps the provenance, so a spread cannot launder a stored value.
        expect(resolveConfiguredCanonicalServerUrl({ ...stored, UNRELATED: "1" })).toBeUndefined();
        // An operator value written over a copied overlay is the deployment's again.
        expect(resolveConfiguredCanonicalServerUrl({ ...stored, HAPPIER_PUBLIC_SERVER_URL: "https://ops.example.test" }))
            .toBe("https://ops.example.test");
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
