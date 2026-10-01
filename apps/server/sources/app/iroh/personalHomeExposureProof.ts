import { isAnonymousSignupExplicitlyDisabled } from '@/app/auth/authPolicy';
import type { BoundServerListener } from '@/app/runtime/startupReceipt';
import { isPersonalHomeRuntimePurpose } from '@/app/runtime/personalHomeRuntimePurpose';

const PERSONAL_HOME_LOOPBACK_HOST = '127.0.0.1';

function readExpectedApiPort(env: NodeJS.ProcessEnv): number | null {
    const raw = String(env.PORT ?? '').trim();
    if (!raw) return null;
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
    if (!isPersonalHomeRuntimePurpose(params.env.HAPPIER_MANAGED_RELAY_PURPOSE)) return false;
    if (!isAnonymousSignupExplicitlyDisabled(params.env)) return false;
    if (!params.listener || params.listener.host !== PERSONAL_HOME_LOOPBACK_HOST) return false;

    const expectedPort = readExpectedApiPort(params.env);
    if (expectedPort === null || params.listener.port !== expectedPort) return false;

    const canonicalServerUrl = String(params.env.HAPPIER_CANONICAL_SERVER_URL ?? '').trim();
    if (canonicalServerUrl !== `http://${PERSONAL_HOME_LOOPBACK_HOST}:${expectedPort}`) return false;

    return true;
}
