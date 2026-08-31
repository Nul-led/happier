import { describe, it } from 'vitest';

import {
  assertPersonalHomeBootstrapRecoveryContract,
  assertPersonalHomeDaemonSetupNonBlockingContract,
  assertPersonalHomeNoIngressContract,
  assertPersonalHomeRuntimeSpecContract,
  assertPersonalHomeSignupClosureContract,
} from '../../src/scenarios/personalHome.scenario';

/**
 * Ordinary owner-level supporting contracts for the Personal Home shell-first corridor. These
 * names describe the behavior each check proves; acceptance IDs and run status are owned by the
 * Lane 09 plan and its sole release report, not by test titles or source registries.
 */
describe('Personal Home shell-first owner contracts', () => {
  it('runtime spec stays loopback, plaintext, and renders the signup closure', async () => {
    await assertPersonalHomeRuntimeSpecContract();
  });

  it('bootstrap resumes from persisted facts after an interruption without duplicating state', async () => {
    await assertPersonalHomeBootstrapRecoveryContract();
  });

  it('persists and reapplies signup closure and refuses unverified non-loopback exposure', async () => {
    await assertPersonalHomeSignupClosureContract();
  });

  it('returns typed unavailable states for public exposure without a proxy fallback', async () => {
    await assertPersonalHomeNoIngressContract();
  });

  it('fails daemon setup typed and scoped while provisioned Home data stays untouched', async () => {
    await assertPersonalHomeDaemonSetupNonBlockingContract();
  });
});
