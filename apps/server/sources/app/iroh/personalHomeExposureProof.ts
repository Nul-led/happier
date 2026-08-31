import { isAnonymousSignupExplicitlyDisabled } from '@/app/auth/authPolicy';
import { resolveConfiguredCanonicalServerUrl } from '@/app/serverUrls/effectiveServerUrls';
import type { BoundServerListener } from '@/app/runtime/startupReceipt';

const PERSONAL_HOME_LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_API_PORT = 3005;

function readExpectedApiPort(env: NodeJS.ProcessEnv): number | null {
    const raw = String(env.PORT ?? '').trim();
    if (!raw) return DEFAULT_API_PORT;
    if (!/^\d+$/u.test(raw)) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Server-local final proof before the optional Personal Home Iroh carrier is
 * composed. This deliberately reuses the auth policy owner instead of sending
 * a synthetic signup request: a valid request could create an Account if the
 * policy diverged, while an invalid signature is rejected before signup policy
 * is evaluated. Keeping this proof synchronous also ensures optional carrier
 * composition can neither mutate account state nor hold HTTP startup open.
 */
export function verifyPersonalHomeExposureProof(params: Readonly<{
    env: NodeJS.ProcessEnv;
    listener: BoundServerListener | null;
}>): boolean {
    if (params.env.HAPPIER_MANAGED_RELAY_PURPOSE !== 'personal-home') return false;
    if (!isAnonymousSignupExplicitlyDisabled(params.env)) return false;
    if (!params.listener || params.listener.host !== PERSONAL_HOME_LOOPBACK_HOST) return false;

    const expectedPort = readExpectedApiPort(params.env);
    if (expectedPort === null || params.listener.port !== expectedPort) return false;

    const canonicalServerUrl = resolveConfiguredCanonicalServerUrl(params.env);
    if (!canonicalServerUrl) return false;
    let canonicalUrl: URL;
    try {
        canonicalUrl = new URL(canonicalServerUrl);
    } catch {
        return false;
    }
    const canonicalPort = canonicalUrl.port
        ? Number(canonicalUrl.port)
        : canonicalUrl.protocol === 'https:' ? 443 : 80;
    if (canonicalUrl.hostname !== PERSONAL_HOME_LOOPBACK_HOST || canonicalPort !== expectedPort) return false;

    return true;
}
