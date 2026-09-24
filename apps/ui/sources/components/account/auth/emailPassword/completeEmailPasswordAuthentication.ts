import type { AuthCredentialLifecycleResult, HomeCredentialTarget } from '@/auth/context/AuthContext';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { SecretKeyBackupModal } from '@/components/account/SecretKeyBackupModal';
import { Modal } from '@/modal';
import { HappyError } from '@/utils/errors/errors';

import type { EmailPasswordAuthOutcome } from './EmailPasswordAuthPanel';

type CompletionResult = 'completed' | 'retired';

async function discloseProvisionedRecoveryKey(
    recoverySecret: Uint8Array,
    target: HomeCredentialTarget,
): Promise<'saved' | 'later' | 'interrupted'> {
    const disclosureSecret = recoverySecret.slice();
    recoverySecret.fill(0);

    return await new Promise((resolve) => {
        let settled = false;
        let modalId = '';
        const settle = (result: 'saved' | 'later' | 'interrupted') => {
            if (settled) return;
            settled = true;
            // The decision is captured before resuming any destination. The
            // modal also clears on unmount, but this owner must not depend on
            // navigation successfully unmounting it to retire the bytes.
            disclosureSecret.fill(0);
            resolve(result);
        };

        try {
            modalId = Modal.show({
                component: SecretKeyBackupModal,
                props: {
                    secret: disclosureSecret,
                    onSaved: async () => {
                        await TokenStorage.setRecoveryKeyReminderDismissed(true, target).catch(() => false);
                        settle('saved');
                    },
                    onDefer: async () => {
                        await TokenStorage.setRecoveryKeyReminderDismissed(false, target).catch(() => false);
                        settle('later');
                    },
                },
                // Account creation has already committed. The two explicit actions
                // are the truthful exits; an accidental backdrop/back dismissal
                // must not discard the one process-held disclosure before a choice.
                dismissible: false,
                closeOnBackdrop: false,
                onHostUnmount: () => settle('interrupted'),
            });
        } catch {
            settle('interrupted');
            return;
        }
        if (!modalId) {
            disclosureSecret.fill(0);
            settle('interrupted');
            return;
        }
    });
}

/**
 * Shared post-result boundary for every mounted native email/password host.
 *
 * A provisioned Account already exists when this runs, so credentials are
 * persisted first. Fresh E2EE creation then pauses the caller's destination
 * until the canonical recovery-key modal records Saved or Later. Process loss
 * does not invent durable secret custody: the exact existing credentials stay
 * stored, the reminder remains available, and this invocation does not finish
 * a stale destination. A credential lifecycle that does not complete raises a
 * typed refusal rather than returning a value both hosts would have to branch
 * on identically; `retired` is the one outcome a host may ignore.
 */
export async function completeEmailPasswordAuthentication(params: Readonly<{
    outcome: EmailPasswordAuthOutcome;
    target: HomeCredentialTarget;
    signal?: AbortSignal;
    loginWithCredentials: (
        credentials: AuthCredentials,
        options: Readonly<{ target: HomeCredentialTarget }>,
    ) => Promise<AuthCredentialLifecycleResult>;
    onCompleted: () => void | Promise<void>;
}>): Promise<CompletionResult> {
    let persistence: AuthCredentialLifecycleResult;
    try {
        persistence = await params.loginWithCredentials(params.outcome.credentials, {
            target: params.target,
        });
    } catch (cause) {
        params.outcome.recoverySecret?.fill(0);
        throw cause;
    }
    if (persistence.kind !== 'completed') {
        // The Account exists; only this device's credential lifecycle did not
        // complete. The recovery key is the one process-held handle to it, so
        // it is disclosed here — the terminal disposition — instead of being
        // discarded, and the refusal is then raised so the mounted host keeps
        // its flow open and presents it. A silent fall-through would navigate
        // away from an Account this device cannot sign in to.
        if (params.outcome.recoverySecret) {
            await TokenStorage.setRecoveryKeyReminderDismissed(false, params.target).catch(() => false);
            await discloseProvisionedRecoveryKey(params.outcome.recoverySecret, params.target);
        }
        throw new HappyError('Native credentials did not complete their lifecycle on this device', false, {
            kind: 'auth',
            // The Home applied the change and this device cannot confirm it is
            // usable here: the shared unconfirmed-outcome presentation, which
            // also re-reads the Account, is exactly that statement.
            code: 'operation_failed',
        });
    }

    if (params.outcome.recoverySecret) {
        // Once native provision returned a recovery key, the Account already
        // exists. A host transition caused by publishing its credentials must
        // not cancel the one canonical disclosure. Only Save/Later completes
        // the intended destination; process/modal-host loss retires it while
        // the persisted Account remains recoverable through existing Settings.
        await TokenStorage.setRecoveryKeyReminderDismissed(false, params.target).catch(() => false);
        const decision = await discloseProvisionedRecoveryKey(params.outcome.recoverySecret, params.target);
        if (decision === 'interrupted') return 'retired';
    } else if (params.signal?.aborted) {
        return 'retired';
    }

    await params.onCompleted();
    return 'completed';
}
