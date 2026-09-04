import {
    PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY,
    PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY_ENV,
} from '@happier-dev/cli-common/firstPartyRuntime';

/** V4 is an irreversible boundary for old servers. The candidate must refuse
 * before database mutation unless the invoking updater can recover forward. */
export function assertForwardRecoveryCapableUpdater(env: NodeJS.ProcessEnv): void {
    if (String(env[PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY_ENV] ?? '').trim()
        !== PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY) {
        throw new Error('Qualified Connected Accounts V4 requires a forward-recovery-capable updater; update the Happier installer before retrying.');
    }
}
