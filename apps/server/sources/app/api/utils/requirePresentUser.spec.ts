import { describe, expect, it, vi } from "vitest";

import { PRESENT_USER_REQUIRED_ERROR, requirePresentUser } from "./requirePresentUser";

function createReply() {
    const send = vi.fn((payload: unknown) => payload);
    const code = vi.fn(() => ({ send }));
    return { reply: { code }, code, send };
}

describe("requirePresentUser", () => {
    it("admits only an explicitly verified ordinary account present-user credential", async () => {
        const accepted = createReply();
        await expect(requirePresentUser({
            authAuthority: "present_user",
            authTokenKind: "account",
        }, accepted.reply)).resolves.toBeUndefined();
        expect(accepted.code).not.toHaveBeenCalled();

        for (const request of [
            { authAuthority: "present_user" },
            { authAuthority: "present_user", authTokenKind: "account_directory" },
            { authAuthority: "present_user", authTokenKind: "unknown" },
            { authAuthority: "account_automation", authTokenKind: "account" },
        ]) {
            const rejected = createReply();
            await expect(requirePresentUser(request, rejected.reply)).resolves.toEqual({
                error: PRESENT_USER_REQUIRED_ERROR,
            });
            expect(rejected.code).toHaveBeenCalledWith(403);
        }
    });
});
