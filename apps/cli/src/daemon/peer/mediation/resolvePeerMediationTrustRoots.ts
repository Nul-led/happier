import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';

import type { DirectRouteGrantTrustRoot } from './verifyDirectRouteGrant';

export function resolvePeerMediationTrustRoots(
  snapshot: CliServerFeaturesSnapshot | undefined,
  nowMs: number,
): readonly DirectRouteGrantTrustRoot[] {
  return snapshot?.status === 'ready' && snapshot.provenance === 'authenticated'
    ? snapshot.features.capabilities.machines.peerMediation.grantSigningKeys
        .filter((key) => key.expiresAt == null || key.expiresAt > nowMs)
        .map((key) => ({ keyId: key.keyId, publicKey: key.publicKey, expiresAt: key.expiresAt }))
    : [];
}
