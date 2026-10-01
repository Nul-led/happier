import { describe, expect, it } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";

import { renderAuthEmailV1 } from "./renderAuthEmail";
import type { AuthEmailMessage } from "./authEmailDelivery";

const to = { address: "Alice@Example.com", normalizedEmail: "alice@example.com" };
const expiresAt = new Date("2026-09-06T00:00:00.000Z");

const verification: AuthEmailMessage = {
    kind: "native_email_verification",
    to,
    verifyUrl: "https://app.happier.dev/auth/email/verify/AAAA",
    expiresAt,
};

const reset: AuthEmailMessage = {
    kind: "plain_password_reset",
    to,
    resetUrl: "https://app.happier.dev/auth/password/reset/BBBB",
    expiresAt,
};

const guidance: AuthEmailMessage = {
    kind: "e2ee_password_recovery_guidance",
    to,
    recoveryEntryUrl: "https://app.happier.dev/recovery",
};

const notice: AuthEmailMessage = {
    kind: "account_authentication_changed_notice",
    to,
    change: "password_reset",
    occurredAt: expiresAt,
    accountSecurityUrl: "https://app.happier.dev/settings/security",
};

describe("renderAuthEmailV1", async () => {
    it("renders multipart English text and HTML carrying the exact action URL", async () => {
        const rendered = await renderAuthEmailV1(verification);

        expect(rendered.subject).toBe("Verify your email address");
        expect(rendered.text).toContain(verification.verifyUrl);
        expect(rendered.html).toContain(verification.verifyUrl);
        expect(rendered.text).toContain("24 hours");
    });

    it("states the one-hour reset window and that an unrequested reset can be ignored", async () => {
        const rendered = await renderAuthEmailV1(reset);

        expect(rendered.subject).toBe("Reset your Happier password");
        expect(rendered.text).toContain(reset.resetUrl);
        expect(rendered.text).toContain("1 hour");
        expect(rendered.text.toLowerCase()).toContain("did not request");
    });

    it("routes E2EE Accounts to recovery entry and mails no envelope-opening bearer", async () => {
        const rendered = await renderAuthEmailV1(guidance);

        expect(rendered.text).toContain(guidance.recoveryEntryUrl);
        expect(rendered.text.toLowerCase()).toContain("recovery key");
        expect(rendered.text.toLowerCase()).not.toContain("reset link");
    });

    it("describes each authentication change in the security notice", async () => {
        expect((await renderAuthEmailV1(notice)).text.toLowerCase()).toContain("password was reset");
        expect((await renderAuthEmailV1({ ...notice, change: "sign_in_email_changed" })).text.toLowerCase())
            .toContain("sign-in email");
    });

    it("delivers the security notice without a link when the Home cannot publish its Security destination", async () => {
        const rendered = await renderAuthEmailV1({ ...notice, accountSecurityUrl: null });
        expect(rendered.text.toLowerCase()).toContain("password was reset");
        expect(rendered.html).not.toMatch(/<a\b/i);
        expect(rendered.text).not.toContain("null");
    });

    it("never embeds remote tracking content, scripts, or the recipient's raw credentials", async () => {
        for (const message of [verification, reset, guidance, notice]) {
            const rendered = await renderAuthEmailV1(message);
            expect(rendered.html).not.toMatch(/<script/i);
            expect(rendered.html).not.toMatch(/<img[^>]+src=["']https?:/i);
            expect(rendered.html).not.toMatch(/background-image/i);
        }
    });

    it("escapes recipient-derived text instead of interpolating raw HTML", async () => {
        const rendered = await renderAuthEmailV1({
            ...verification,
            to: { address: '"><script>alert(1)</script>@example.com', normalizedEmail: "alice@example.com" },
        });

        expect(rendered.html).not.toContain("<script>alert(1)</script>");
        expect(rendered.html).toContain("&lt;script&gt;");
    });

    it("attaches a CID PNG that decodes to the exact supplied Home invitation URL", async () => {
        const joinUrl = "https://app.example.test/explicit-home-fixture/join/" + "A".repeat(43);
        const rendered = await renderAuthEmailV1({
            kind: "invitation", to, joinUrl, homeName: "Home <one>",
            teamName: "Team", inviterLabel: "Alice", requestedRole: "member",
            sharesSessionHistory: true, emailBound: true, expiresAt,
        });
        expect(rendered.text).toContain(joinUrl);
        expect(rendered.html).toContain(joinUrl);
        expect(rendered.html).toContain("Home &lt;one&gt;");
        expect(rendered.attachments).toHaveLength(1);
        const attachment = rendered.attachments![0];
        expect(rendered.html).toContain(`src="cid:${attachment.cid}"`);
        const decoded = await sharp(attachment.content).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height)?.data).toBe(joinUrl);
    });

    it("states times as a readable explicit-UTC date, never a raw machine timestamp", async () => {
        const invitation = await renderAuthEmailV1({
            kind: "invitation", to, joinUrl: "https://app.example.test/join/" + "A".repeat(43),
            homeName: "Home", teamName: "Team", inviterLabel: "Alice", requestedRole: "member",
            sharesSessionHistory: false, emailBound: true, expiresAt,
        });
        expect(invitation.text).toContain("This invitation expires on 6 September 2026 at 00:00 UTC.");
        expect(invitation.text).not.toContain(expiresAt.toISOString());

        const changed = await renderAuthEmailV1(notice);
        expect(changed.text).toContain("This happened on 6 September 2026 at 00:00 UTC.");
        expect(changed.text).not.toContain(expiresAt.toISOString());
    });
});
