import { createTransport } from "nodemailer";
import type { AuthEmailSmtpConfig, AuthEmailSmtpTransport } from "./authEmailAdapters";

/** SMTP is the external leaf; rendering, delivery status and retries stay with the auth owner. */
export function createProductionAuthEmailSmtpTransport(config: AuthEmailSmtpConfig): AuthEmailSmtpTransport {
    const transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.username !== null ? { auth: { user: config.username, pass: config.password ?? "" } } : {}),
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
    });
    return {
        async send(envelope) {
            await transport.sendMail({
                ...envelope,
                attachments: envelope.attachments ? [...envelope.attachments] : undefined,
            });
        },
    };
}
