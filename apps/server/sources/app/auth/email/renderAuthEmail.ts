import QRCode from "qrcode";
import type {
    AccountAuthenticationChangeV1,
    AuthEmailMessage,
} from "./authEmailDelivery";

/**
 * Current server source has no canonical mail-localization owner and no
 * recipient-locale authority, so V1 transactional templates are code-owned
 * English. Localized mail becomes a separate extension when those facts exist;
 * client-rendered bodies and a server i18n platform are both out of scope.
 */
export type RenderedAuthEmailV1 = Readonly<{
    subject: string;
    text: string;
    html: string;
    attachments?: readonly Readonly<{
        filename: string;
        contentType: "image/png";
        contentDisposition: "inline";
        cid: string;
        content: Buffer;
    }>[];
}>;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const AUTHENTICATION_CHANGE_SENTENCE = {
    password_connected: "A password was connected to your Happier account.",
    password_changed: "Your Happier password was changed.",
    password_removed: "The password on your Happier account was removed.",
    password_reset: "Your Happier password was reset.",
    sign_in_email_changed: "The sign-in email on your Happier account was changed.",
} as const satisfies Record<AccountAuthenticationChangeV1, string>;

function renderDocument(params: Readonly<{
    heading: string;
    paragraphs: readonly string[];
    action?: Readonly<{ label: string; url: string }>;
    closing: readonly string[];
    qrContentId?: string;
}>): Readonly<{ text: string; html: string }> {
    const textLines = [params.heading, "", ...params.paragraphs];
    if (params.action) {
        textLines.push("", `${params.action.label}:`, params.action.url);
    }
    textLines.push("", ...params.closing);

    const htmlBody = [
        `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(params.heading)}</h1>`,
        ...params.paragraphs.map((paragraph) =>
            `<p style="margin:0 0 12px;">${escapeHtml(paragraph)}</p>`),
        ...(params.action
            ? [
                `<p style="margin:0 0 12px;"><a href="${escapeHtml(params.action.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111111;color:#ffffff;text-decoration:none;">${escapeHtml(params.action.label)}</a></p>`,
                `<p style="margin:0 0 12px;font-size:13px;">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;">${escapeHtml(params.action.url)}</span></p>`,
            ]
            : []),
        ...(params.qrContentId ? [`<p><img src="cid:${escapeHtml(params.qrContentId)}" alt="Scan to open this invitation" width="240" style="max-width:100%;height:auto;"></p>`] : []),
        ...params.closing.map((paragraph) =>
            `<p style="margin:0 0 12px;font-size:13px;color:#555555;">${escapeHtml(paragraph)}</p>`),
    ].join("\n");

    // Restrained responsive shell: no remote assets, scripts, tracking pixels or Team CSS.
    const html = [
        '<!doctype html>',
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '</head>',
        '<body style="margin:0;padding:24px;background:#f6f6f6;">',
        '<div style="max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111111;">',
        htmlBody,
        '</div></body></html>',
    ].join("\n");

    return { text: textLines.join("\n"), html };
}

export async function renderAuthEmailV1(message: AuthEmailMessage): Promise<RenderedAuthEmailV1> {
    switch (message.kind) {
        case "native_email_verification": {
            const document = renderDocument({
                heading: "Verify your email address",
                paragraphs: [
                    `Confirm that ${message.to.address} belongs to you to continue in Happier.`,
                    "This link can be used once and expires in 24 hours.",
                ],
                action: { label: "Verify email address", url: message.verifyUrl },
                closing: ["If you did not start this, you can ignore this message and nothing will change."],
            });
            return { subject: "Verify your email address", ...document };
        }
        case "plain_password_reset": {
            const document = renderDocument({
                heading: "Reset your Happier password",
                paragraphs: [
                    "Use the link below to choose a new password.",
                    "This link can be used once and expires in 1 hour. Resetting your password signs you out of your other sessions.",
                ],
                action: { label: "Choose a new password", url: message.resetUrl },
                closing: ["If you did not request a password reset, you can ignore this message and your password stays unchanged."],
            });
            return { subject: "Reset your Happier password", ...document };
        }
        case "e2ee_password_recovery_guidance": {
            const document = renderDocument({
                heading: "Recovering an end-to-end encrypted account",
                paragraphs: [
                    "This account is end-to-end encrypted, so Happier cannot restore its data from email.",
                    "Use your recovery key, or a device that is still signed in, to regain access and set a new password.",
                ],
                action: { label: "Open account recovery", url: message.recoveryEntryUrl },
                closing: ["If you did not ask to recover an account, you can ignore this message."],
            });
            return { subject: "Recovering your Happier account", ...document };
        }
        case "account_authentication_changed_notice": {
            const document = renderDocument({
                heading: "Your account sign-in settings changed",
                paragraphs: [
                    AUTHENTICATION_CHANGE_SENTENCE[message.change],
                    `This happened on ${message.occurredAt.toISOString()}.`,
                ],
                ...(message.accountSecurityUrl ? {
                    action: { label: "Review account security", url: message.accountSecurityUrl },
                } : {}),
                closing: ["If you did not make this change, review your account security now."],
            });
            return { subject: "Your account sign-in settings changed", ...document };
        }
        case "invitation": {
            const cid = "invitation-qr@happier";
            const content = await QRCode.toBuffer(message.joinUrl, { type: "png", errorCorrectionLevel: "M", scale: 6 });
            const document = renderDocument({
                heading: message.teamName ? `Join ${message.teamName}` : `Join ${message.homeName}`,
                paragraphs: [
                    `Home: ${message.homeName}.`,
                    ...(message.teamName ? [`Team: ${message.teamName}.`] : []),
                    ...(message.inviterLabel ? [`Invited by ${message.inviterLabel}.`] : []),
                    ...(message.requestedRole ? [`Your role will be ${message.requestedRole}.`] : []),
                    message.sharesSessionHistory
                        ? "This invitation includes access to shared session history."
                        : "This invitation does not include earlier session history.",
                    message.emailBound
                        ? `This invitation is intended for ${message.to.address}. Keep this link private.`
                        : "Anyone with this link can accept.",
                    `This invitation expires on ${message.expiresAt.toISOString()}.`,
                ],
                action: { label: "Preview invitation", url: message.joinUrl },
                qrContentId: cid,
                closing: ["Opening this link previews the invitation. You join only after choosing to accept it."],
            });
            return {
                subject: message.teamName ? `Invitation to ${message.teamName}` : `Invitation to ${message.homeName}`,
                ...document,
                attachments: [{ filename: "invitation.png", contentType: "image/png", contentDisposition: "inline", cid, content }],
            };
        }
    }
}
