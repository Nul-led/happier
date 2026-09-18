import { parseIntEnv } from "@/config/env";
import {
    createDisabledAuthEmailDelivery,
    createSmtpAuthEmailDelivery,
    type AuthEmailSmtpConfig,
    type AuthEmailSmtpTransport,
} from "./authEmailAdapters";
import type { AuthEmailDelivery } from "./authEmailDelivery";
import { createProductionAuthEmailSmtpTransport } from "./smtpAuthEmailTransport";

function readTrimmed(value: string | undefined): string | null {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    const raw = (value ?? "").trim().toLowerCase();
    if (!raw) return fallback;
    return ["1", "true", "yes", "on"].includes(raw);
}

/**
 * SMTP is the only configurable V1 transport. A deployment that has not
 * configured a host is unconfigured, not broken: mail-dependent operations
 * report unavailability while every other authentication journey continues.
 */
export function resolveAuthEmailSmtpConfig(
    env: Record<string, string | undefined>,
): AuthEmailSmtpConfig | null {
    const host = readTrimmed(env.HAPPIER_AUTH_EMAIL_SMTP_HOST);
    const fromAddress = readTrimmed(env.HAPPIER_AUTH_EMAIL_FROM_ADDRESS);
    if (!host || !fromAddress) return null;

    const secure = parseBoolean(env.HAPPIER_AUTH_EMAIL_SMTP_SECURE, false);
    return {
        host,
        port: parseIntEnv(env.HAPPIER_AUTH_EMAIL_SMTP_PORT, secure ? 465 : 587, { min: 1, max: 65_535 }),
        secure,
        username: readTrimmed(env.HAPPIER_AUTH_EMAIL_SMTP_USERNAME),
        password: readTrimmed(env.HAPPIER_AUTH_EMAIL_SMTP_PASSWORD),
        fromAddress,
        fromName: readTrimmed(env.HAPPIER_AUTH_EMAIL_FROM_NAME) ?? "Happier",
    };
}

export type AuthEmailSmtpTransportFactory = (config: AuthEmailSmtpConfig) => AuthEmailSmtpTransport;

export function resolveAuthEmailDelivery(
    env: Record<string, string | undefined>,
    deps?: Readonly<{ createSmtpTransport?: AuthEmailSmtpTransportFactory }>,
): AuthEmailDelivery {
    const config = resolveAuthEmailSmtpConfig(env);
    if (!config) return createDisabledAuthEmailDelivery();
    const createSmtpTransport = deps?.createSmtpTransport ?? createProductionAuthEmailSmtpTransport;
    return createSmtpAuthEmailDelivery({ config, transport: createSmtpTransport(config) });
}

/**
 * Consumed by method readiness so the product can explain which mail-dependent
 * operations are unavailable rather than failing them at submit time.
 */
export function isAuthEmailDeliveryReady(
    env: Record<string, string | undefined>,
): boolean {
    return resolveAuthEmailSmtpConfig(env) !== null;
}
