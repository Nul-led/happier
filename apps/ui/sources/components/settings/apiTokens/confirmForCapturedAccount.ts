import { Modal } from '@/modal';
import type { ServerAccountScopeLifetime } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';

import { resolveApiTokenOperationErrorMessageKey } from './apiTokenSettingsPresentation';

/**
 * Opens a destructive confirmation bound to the Account and Home captured when it opens. Returns that
 * target only if the person confirmed and it is still the current one; a switch while the dialog was
 * open aborts with a message instead of acting on the newly current Account. Pass the returned target
 * (and its `scope`) to the action, which checks it again at dispatch.
 *
 * The owner decides what "current" means: the active Account for Account settings, the exact Home's
 * credential binding for Home administration.
 */
export async function confirmForCapturedAccount<TTarget extends ServerAccountScopeLifetime>(
    controller: Readonly<{ captureDestructiveTarget(): TTarget | null }>,
    confirm: () => Promise<boolean>,
): Promise<TTarget | null> {
    const target = controller.captureDestructiveTarget();
    if (!target) {
        await Modal.alertAsync(t('common.error'), t(resolveApiTokenOperationErrorMessageKey('account_unavailable')));
        return null;
    }
    if (!(await confirm())) return null;
    if (!target.isCurrent()) {
        await Modal.alertAsync(t('common.error'), t(resolveApiTokenOperationErrorMessageKey('account_changed')));
        return null;
    }
    return target;
}
