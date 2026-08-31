import type { LoopbackTunnelProbeResult } from '@/sync/runtime/nativeLoopbackTunnels/types';

import { createEndpointReadinessProbe } from '@/sync/runtime/connectivity/createEndpointReadinessProbe';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import type { IrohHomeTunnelRequest } from './types';

export type IrohHomeTunnelProbeFailureReason =
    | 'health-unavailable'
    | 'auth-failed'
    | 'identity-mismatch'
    | 'features-unavailable';

/**
 * Full verification chain for a native Iroh Home lease, in order:
 * 1. real `/health` readiness against the lease's exact loopback origin;
 * 2. authenticated `/v1/auth/ping` with the endpoint-scoped token when the
 *    caller is already enrolled; pre-token enrollment intentionally skips it;
 * 3. `/v1/features` through the same origin whose `serverIdentityId` equals the
 *    expected Home identity.
 *
 * Both existing probe owners are composed (never duplicated): the combined
 * health+auth readiness probe and the explicit-endpoint feature probe with the
 * canonical URL kept as the cache/profile key and the lease origin as transport.
 */
export async function probeIrohHomeTunnelOrigin(
    url: string,
    request: IrohHomeTunnelRequest,
): Promise<LoopbackTunnelProbeResult<IrohHomeTunnelProbeFailureReason>> {
    const homeServerIdentityId = request.homeServerIdentityId.trim();
    const token = request.verification.kind === 'authenticated'
        ? request.verification.token.trim()
        : null;
    if (!homeServerIdentityId || (request.verification.kind === 'authenticated' && !token)) {
        // Authenticated acquisition requires its scoped token; both modes
        // require the expected Home identity before any request is made.
        return { ok: false, reason: 'auth-failed' };
    }

    const readiness = await createEndpointReadinessProbe({ endpoint: url, token })();
    if (readiness.status === 'auth_failed') {
        return { ok: false, reason: 'auth-failed' };
    }
    if (readiness.status !== 'ready') {
        return { ok: false, reason: 'health-unavailable' };
    }

    const features = await probeServerFeaturesAtUrl(request.canonicalServerUrl, {
        runtimeOrigin: url,
        serverId: request.remoteHostId,
        force: true,
    });
    if (features.status !== 'ready') {
        return { ok: false, reason: 'features-unavailable' };
    }
    if ((features.serverIdentityId ?? null) !== homeServerIdentityId) {
        return { ok: false, reason: 'identity-mismatch' };
    }
    return { ok: true };
}
