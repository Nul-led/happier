import { describe, it } from 'vitest';

import {
  assertPersonalHomeBackupRestoreContract,
  assertPersonalHomeRelocationContract,
  assertPersonalHomeUninstallPreservesDataContract,
} from '../../src/scenarios/personalHomeOperations.scenario';

/**
 * Ordinary owner-level supporting contracts for Personal Home operations, driven through the
 * shared task kinds and the canonical operation owner. Acceptance IDs and run status are owned
 * by the Lane 09 plan and its sole release report, not by test titles or source registries.
 */
describe('Personal Home operation owner contracts', () => {
  it('uninstall removes runtime payload while database, files, and master secret survive', async () => {
    await assertPersonalHomeUninstallPreservesDataContract();
  });

  it('backup and restore preserve identity and data with rollback on failed activation', { timeout: 30_000 }, async () => {
    await assertPersonalHomeBackupRestoreContract();
  });

  it('relocation keeps the source recoverable, quarantines the destination on failure, and fails closed without a destination resolver', { timeout: 30_000 }, async () => {
    await assertPersonalHomeRelocationContract();
  });
});
