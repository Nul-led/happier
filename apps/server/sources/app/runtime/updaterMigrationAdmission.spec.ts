import { describe, expect, it } from 'vitest';

import { assertForwardRecoveryCapableUpdater } from './updaterMigrationAdmission';

describe('irreversible migration updater admission', () => {
    it('refuses an updater that cannot preserve the forward-only update record', () => {
        expect(() => assertForwardRecoveryCapableUpdater({})).toThrow(/forward-recovery-capable updater/u);
    });

    it('admits the exact current updater capability', () => {
        expect(() => assertForwardRecoveryCapableUpdater({
            HAPPIER_UPDATER_FORWARD_RECOVERY_CAPABILITY: 'personal-home-update-record-v1',
        })).not.toThrow();
    });
});
