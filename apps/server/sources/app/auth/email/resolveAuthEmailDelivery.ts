import { parseIntEnv } from "@/config/env";
import {
    createDisabledAuthEmailDelivery,
    createSmtpAuthEmailDelivery,
    type AuthEmailSmtpConfig,
    type AuthEmailSmtpTransport,
} from "./authEmailAdapters";
import type { AuthEmailDelivery } from "./authEmailDelivery";
import { createProductionAuthEmailSmtpTransport } from "./smtpAuthEmailTransport";
import { isAuthEmailApplicationLinkBuildable, type ResolveAuthEmailApplicationLinkTarget } from "./nativeAuthEmailOperations";

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

/** Whether an SMTP transport is configured. A transport alone is not mail readiness. */
export function isAuthEmailTransportConfigured(
    env: Record<string, string | undefined>,
): boolean {
    return resolveAuthEmailSmtpConfig(env) !== null;
}

/**
 * The one mail-readiness answer. Mail-dependent actions (account creation by email, password reset,
 * sign-in email change, mailed invitations) are ready only when mail can be sent **and** the link it
 * must carry can be built from the same facts the send path renders it from. It is Home-wide, never
 * per address, so existence-neutral request routes keep answering identically. A failing link-target
 * read is "not ready", never an error.
 */
export async function resolveAuthEmailReadiness(input: Readonly<{
    transportReady: boolean;
    resolveApplicationLinkTarget: ResolveAuthEmailApplicationLinkTarget | null;
}>): Promise<boolean> {
    if (!input.transportReady || !input.resolveApplicationLinkTarget) return false;
    try {
        return isAuthEmailApplicationLinkBuildable(await input.resolveApplicationLinkTarget());
    } catch {
        return false;
    }
}

/**
 * Startup-registered link-target owner for callers that only hold the process environment (feature
 * projection, Home governance). The API composition registers the same resolver its mail routes use.
 */
let processApplicationLinkTarget: ResolveAuthEmailApplicationLinkTarget | null = null;

export function registerAuthEmailApplicationLinkTarget(resolver: ResolveAuthEmailApplicationLinkTarget | null): void {
    processApplicationLinkTarget = resolver;
}

/**
 * Process-wide mail readiness from the environment's transport and the registered link target.
 * Consumed by method readiness so the product can explain which mail-dependent operations are
 * unavailable rather than failing them, or silently sending nothing, at submit time.
 */
export async function isAuthEmailDeliveryReady(
    env: Record<string, string | undefined>,
): Promise<boolean> {
    return await resolveAuthEmailReadiness({
        transportReady: isAuthEmailTransportConfigured(env),
        resolveApplicationLinkTarget: processApplicationLinkTarget,
    });
}
