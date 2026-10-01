import { RPC_ERROR_MESSAGES } from '@happier-dev/protocol/rpc';

import { t } from '@/text';

/**
 * The one sentence a filesystem listing failure gives as its cause, for the tree's root state and for a
 * folder inside it. The raw error stays on the diagnostic channel; it is never the sentence.
 */
export function resolveFilesystemErrorReason(error: string | null | undefined): string {
    if (error === RPC_ERROR_MESSAGES.METHOD_NOT_AVAILABLE) return t('errors.daemonUnavailableBody');
    if (error === 'EACCES' || error === 'EPERM') return t('errors.permissionDenied');
    if (error === 'ENOENT') return t('errors.fileNotFound');
    return t('errors.operationFailed');
}
