import { isAnonymousSignupExplicitlyDisabled } from '@/app/auth/authPolicy';
import { resolveConfiguredCanonicalServerUrl } from '@/app/serverUrls/effectiveServerUrls';
import type { BoundServerListener } from '@/app/runtime/startupReceipt';

const PERSONAL_HOME_LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_API_PORT = 3005;
const INVALID_SIGNUP_PROBE_BODY = Object.freeze({
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
});

function readExpectedApiPort(env: NodeJS.ProcessEnv): number | null {
    const raw = String(env.PORT ?? '').trim();
    if (!raw) return DEFAULT_API_PORT;
    if (!/^\d+$/u.test(raw)) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Server-local final proof before the optional Personal Home Iroh carrier is
 * composed. The deliberately invalid key proof can never create an Account:
 * closed signup returns the required typed refusal, while an open or divergent
 * route returns a different response and therefore keeps exposure disabled.
 */
export async function verifyPersonalHomeExposureProof(params: Readonly<{
    env: NodeJS.ProcessEnv;
    listener: BoundServerListener | null;
    fetchImpl?: typeof fetch;
}>): Promise<boolean> {
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

    try {
        const response = await (params.fetchImpl ?? fetch)(
            `http://${PERSONAL_HOME_LOOPBACK_HOST}:${expectedPort}/v1/auth`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                },
                body: JSON.stringify(INVALID_SIGNUP_PROBE_BODY),
            },
        );
        if (response.status !== 403) return false;
        const body: unknown = await response.json();
        return typeof body === 'object'
            && body !== null
            && 'error' in body
            && body.error === 'signup-disabled';
    } catch {
        return false;
    }
}
