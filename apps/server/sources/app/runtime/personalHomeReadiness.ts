import type { PersonalHomeAuthenticatedReadiness } from '@happier-dev/cli-common/firstPartyRuntime';

import { auth } from '@/app/auth/auth';
import { getOrCreateServerIdentityId } from '@/app/serverIdentity/serverIdentity';
import { db } from '@/storage/db';

/** Composes the AuthModule-owned token round-trip with canonical Home identity
 * and database counts after the server has opened the restored Home. A fresh
 * uninitialized Home has no Account yet and therefore publishes no readiness. */
export async function createPersonalHomeAuthenticatedReadiness(
  env: NodeJS.ProcessEnv,
): Promise<PersonalHomeAuthenticatedReadiness | null> {
  const accountCount = await db.account.count();
  if (accountCount === 0) return null;
  const [authAttestation, homeServerIdentityId, sessionCount] = await Promise.all([
    auth.attestPresentUserTokenRoundTrip(),
    getOrCreateServerIdentityId(env),
    db.session.count(),
  ]);
  if (!Number.isSafeInteger(accountCount) || accountCount < 1 || !Number.isSafeInteger(sessionCount) || sessionCount < 0) {
    throw new Error('Personal Home readiness account/session counts are invalid');
  }
  if (!authAttestation.authenticated) {
    throw new Error('Personal Home authentication readiness attestation failed');
  }
  return {
    authenticated: true,
    homeServerIdentityId,
    accountCount,
    sessionCount,
  };
}
