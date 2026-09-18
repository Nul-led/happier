import {
    PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY,
    PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY_ENV,
} from '@happier-dev/cli-common/firstPartyRuntime/server';

/** Irreversible migrations require the candidate to refuse
 * before database mutation unless the invoking updater can recover forward. */
export function assertForwardRecoveryCapableUpdater(env: NodeJS.ProcessEnv): void {
    if (String(env[PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY_ENV] ?? '').trim()
        !== PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY) {
        throw new Error('This irreversible migration requires a forward-recovery-capable updater; update the Happier installer before retrying.');
    }
}
