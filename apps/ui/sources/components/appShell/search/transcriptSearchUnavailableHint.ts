import { t } from '@/text';

/**
 * One presentation owner for transcript-source availability across Universal
 * Search and contextual Session-list Search.
 */
export function transcriptSearchUnavailableHint(reason: string | null | undefined): string {
    if (reason === 'home_indexing') return t('memorySearchSettings.status.indexing');
    if (reason === 'daemon_no_target' || reason === 'daemon_unavailable') return t('errors.daemonUnavailableBody');
    if (reason === 'home_unavailable' || reason === 'home_unknown') {
        return t('memorySearchSettings.status.unavailableLight');
    }
    return t('memorySearchSettings.disabled.footer');
}
