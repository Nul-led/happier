import { describe, expect, it } from "vitest";

import {
    resolveAuthKeyChallengeV2Policy,
    resolveAuthKeyChallengeV2Requirement,
} from "./authPolicy";

describe("key-challenge v2 auth policy", () => {
    it("defaults ordinary Home compatibility off", () => {
        const env = {} as NodeJS.ProcessEnv;
        expect(resolveAuthKeyChallengeV2Requirement(env)).toBe(false);
        expect(resolveAuthKeyChallengeV2Policy(env)).toEqual({
            ordinaryHomeRequired: false,
        });
    });

    it("uses the explicit switch only for ordinary Home compatibility", () => {
        const enabled = { HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2: "true" } as NodeJS.ProcessEnv;
        const disabled = { HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2: "false" } as NodeJS.ProcessEnv;
        expect(resolveAuthKeyChallengeV2Requirement(enabled)).toBe(true);
        expect(resolveAuthKeyChallengeV2Requirement(disabled)).toBe(false);
    });
});
