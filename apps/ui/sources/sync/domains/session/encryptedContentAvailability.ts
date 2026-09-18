import type { SessionDataKeyHydrationState } from '@/sync/encryption/sessionDataKeyHydration';
import type { AccountRecipientEnvelopeReadiness } from '@happier-dev/protocol';

/**
 * What the current viewer can do about this Session's encrypted content right now.
 *
 * Derived, never persisted: route access, Home connectivity, Account unlock and deletion stay
 * separate concerns, and no component re-interprets a raw crypto failure on its own.
 */
export type SessionContentAvailability =
    | 'ready'
    | 'encrypted_access_pending'
    | 'recipient_encryption_setup_required'
    | 'encrypted_access_needs_repair'
    | 'encrypted_content_unavailable';

/**
 * The Account-owned view of whether this viewer's Account can receive Session keys at all.
 * The Account response owns this decision; local credentials and fingerprints do not replace it.
 */
export type RecipientEncryptionReadiness = AccountRecipientEnvelopeReadiness;

export function deriveSessionContentAvailability(params: Readonly<{
    hydrationState: SessionDataKeyHydrationState;
    recipientReadiness?: RecipientEncryptionReadiness;
    contentAuthenticationFailed?: boolean;
}>): SessionContentAvailability {
    switch (params.hydrationState) {
        case 'not_required':
        case 'ready':
        case 'legacy_fallback_ready':
            // The key path succeeded, so a failure below it is a content fact, not an envelope one.
            return params.contentAuthenticationFailed === true
                ? 'encrypted_content_unavailable'
                : 'ready';
        case 'unopenable_envelope':
            return 'encrypted_access_needs_repair';
        case 'missing_envelope':
            switch (params.recipientReadiness?.status === 'unavailable' ? params.recipientReadiness.reason : undefined) {
                case 'plain_account':
                case 'encryption_setup_required':
                    return 'recipient_encryption_setup_required';
                case 'encryption_inconsistent':
                    return 'encrypted_access_needs_repair';
                default:
                    return 'encrypted_access_pending';
            }
    }
}

/**
 * Every derived value is settled by construction: hydration has finished deciding and retrying
 * cannot change the answer, so a present availability means route and list surfaces stop showing
 * progress.
 */
export function isSessionContentReadable(availability: SessionContentAvailability): boolean {
    return availability === 'ready';
}
