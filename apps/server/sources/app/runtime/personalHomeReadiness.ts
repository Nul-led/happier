import {
  DEFAULT_PERSONAL_HOME_TEAM_NAME,
  type PersonalHomeAuthenticatedReadiness,
} from '@happier-dev/cli-common/firstPartyRuntime/server';

import { auth } from '@/app/auth/auth';
import { bootstrapPersonalHomeTeams } from '@/app/home/governance/personalHomeTeamsBootstrap';
import { getOrCreateServerIdentityId } from '@/app/serverIdentity/serverIdentity';
import { db } from '@/storage/db';

/** Composes the AuthModule-owned token round-trip with canonical Home identity
 * and database counts after the server has opened the restored Home. A fresh
 * uninitialized Home has no Account yet and therefore publishes no readiness. */
export async function createPersonalHomeAuthenticatedReadiness(
  env: NodeJS.ProcessEnv,
): Promise<PersonalHomeAuthenticatedReadiness | null> {
  if (env.HAPPIER_MANAGED_RELAY_PURPOSE !== 'personal-home') {
    throw new Error('Personal Home authenticated readiness requires the personal-home runtime purpose');
  }
  const accountCount = await db.account.count();
  if (accountCount === 0) return null;

  const teamsBootstrap = await bootstrapPersonalHomeTeams({
    runtimePurpose: 'personal-home',
    defaultTeamName: DEFAULT_PERSONAL_HOME_TEAM_NAME,
    env,
  });
  // Multiple active Accounts without an owner require explicit operator
  // selection, but the Home remains authenticated and available so that its
  // administration surface can perform that recovery. Every other bootstrap
  // failure prevents readiness publication.
  if (teamsBootstrap.status !== 'ready' && teamsBootstrap.status !== 'setup_required') {
    throw new Error(`Personal Home Teams bootstrap failed: ${teamsBootstrap.status}`);
  }

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
    teamsBootstrapStatus: teamsBootstrap.status,
  };
}
