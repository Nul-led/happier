import * as React from 'react';
import type { AccountApiTokenSummaryV1 } from '@happier-dev/protocol';

import { Modal } from '@/modal';
import { t } from '@/text';

import type { ApiTokenSettingsController } from './apiTokenSettingsController';
import { confirmForCapturedAccount } from './confirmForCapturedAccount';
import { showApiTokenCreateModal, showApiTokenEditAccessModal } from './showApiTokenCreateModal';

/**
 * The collection's operations, each behind its confirmation and bound to the Account it was confirmed
 * for: create, edit access, revoke one, revoke all. The rail, the list page and a token's detail call
 * these; none of them re-implements a confirmation.
 */
export function useApiTokenOperations(controller: ApiTokenSettingsController) {
    const create = React.useCallback(() => {
        showApiTokenCreateModal(controller);
    }, [controller]);

    const editAccess = React.useCallback((token: AccountApiTokenSummaryV1) => {
        showApiTokenEditAccessModal(controller, token.tokenId);
    }, [controller]);

    const revoke = React.useCallback(async (token: Pick<AccountApiTokenSummaryV1, 'tokenId' | 'label'>): Promise<boolean> => {
        const target = await confirmForCapturedAccount(controller, () => Modal.confirm(
            t('settingsApiTokens.revoke.title', { label: token.label }),
            t('settingsApiTokens.revoke.body'),
            { cancelText: t('common.cancel'), confirmText: t('settingsApiTokens.revoke.confirm'), destructive: true },
        ));
        return target ? await controller.revokeToken(token.tokenId, target) : false;
    }, [controller]);

    const revokeAll = React.useCallback(async (): Promise<void> => {
        const target = await confirmForCapturedAccount(controller, () => Modal.confirm(
            t('settingsApiTokens.revokeAll.title'),
            t('settingsApiTokens.revokeAll.body'),
            { cancelText: t('common.cancel'), confirmText: t('settingsApiTokens.revokeAll.confirm'), destructive: true },
        ));
        if (target) await controller.revokeAllTokens(target);
    }, [controller]);

    return { create, editAccess, revoke, revokeAll };
}
