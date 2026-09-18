import { Modal } from '@/modal';
import { t } from '@/text';

import type { SystemTaskUnmanagedCliDecision } from './approveSystemTaskAuthRequestPrompt';

/**
 * The one ask before this app approves a pairing request from a command line its own managed
 * install path did not place — a repo checkout, an env override, or a binary someone dropped into
 * the managed directory without installing it.
 *
 * The managed case never reaches here: it is approved silently, so ordinary first-run onboarding
 * stays zero-interaction. The question names the resolved command because that is the fact the
 * person can actually judge.
 *
 * Not the QR-pairing modal flow: that switches the focused Home and shows modals unconditionally,
 * which is wrong for the silent managed path this sits beside.
 */
export async function presentUnmanagedCliConsent(
    decision: SystemTaskUnmanagedCliDecision,
): Promise<boolean> {
    return await Modal.confirm(
        t('machine.cliTrust.title'),
        decision.cliCommand
            ? t('machine.cliTrust.body', { command: decision.cliCommand })
            : t('machine.cliTrust.bodyUnknownCommand'),
        { confirmText: t('machine.cliTrust.approve'), cancelText: t('common.cancel') },
    );
}
