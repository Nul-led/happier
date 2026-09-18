import {
    describeAuthEmailDeliveryFailure,
    type AuthEmailDelivery,
    type AuthEmailDeliveryResult,
    type AuthEmailMessage,
} from "./authEmailDelivery";
import { renderAuthEmailV1, type RenderedAuthEmailV1 } from "./renderAuthEmail";

export type AuthEmailSmtpConfig = Readonly<{
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
    password: string | null;
    fromAddress: string;
    fromName: string;
}>;

/** One rendered message ready for submission. Bodies are already multipart-ready. */
export type AuthEmailSmtpEnvelope = Readonly<{
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: RenderedAuthEmailV1["attachments"];
}>;

/**
 * The genuine external boundary: a configured SMTP submission transport. The
 * adapter below owns envelope construction and failure classification so the
 * transport implementation stays a thin, replaceable leaf.
 */
export interface AuthEmailSmtpTransport {
    send(envelope: AuthEmailSmtpEnvelope): Promise<void>;
}

function formatFrom(config: AuthEmailSmtpConfig): string {
    // Display names are code-owned and ASCII-safe, so no encoded-word is needed.
    return config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress;
}

/**
 * Used when no mail transport is configured. Mail-dependent operations stay
 * honestly unavailable instead of silently reporting success, while password
 * login and every non-mail journey keep working.
 */
export function createDisabledAuthEmailDelivery(): AuthEmailDelivery {
    return {
        isReady: false,
        async deliver(): Promise<AuthEmailDeliveryResult> {
            return {
                status: "failed",
                reason: "not_configured",
                detail: "no auth email transport is configured",
            };
        },
    };
}

export function createSmtpAuthEmailDelivery(params: Readonly<{
    config: AuthEmailSmtpConfig;
    transport: AuthEmailSmtpTransport;
}>): AuthEmailDelivery {
    return {
        isReady: true,
        async deliver(message: AuthEmailMessage): Promise<AuthEmailDeliveryResult> {
            let envelope: AuthEmailSmtpEnvelope;
            try {
                const rendered = await renderAuthEmailV1(message);
                envelope = {
                    from: formatFrom(params.config),
                    to: message.to.address,
                    subject: rendered.subject,
                    text: rendered.text,
                    html: rendered.html,
                    attachments: rendered.attachments,
                };
            } catch {
                return {
                    status: "failed",
                    reason: "render_failed",
                    detail: "Auth email rendering failed",
                };
            }

            try {
                await params.transport.send(envelope);
                return { status: "sent" };
            } catch {
                return { status: "failed", reason: "transport_failed", detail: "SMTP submission failed" };
            }
        },
    };
}

export { describeAuthEmailDeliveryFailure };
