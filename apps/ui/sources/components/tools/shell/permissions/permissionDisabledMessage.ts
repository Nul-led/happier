import { t } from '@/text';
import type { TranscriptPermissionDisabledReason } from '@/utils/sessions/deriveTranscriptInteraction';

/**
 * The one sentence a non-actionable prompt shows for why it cannot be answered here. Every prompt
 * surface (permission, approval, question, plan, import) reads it, so a reason never has two wordings.
 */
export function resolvePermissionDisabledMessage(reason: TranscriptPermissionDisabledReason | undefined): string {
    switch (reason) {
        case 'public':
            return t('session.sharing.permissionApprovalsDisabledPublic');
        case 'readOnly':
            return t('session.sharing.permissionApprovalsDisabledReadOnly');
        case 'openSession':
            return t('session.embedded.respondInSession');
        default:
            return t('session.sharing.permissionApprovalsDisabledNotGranted');
    }
}
