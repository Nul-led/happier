import { describe, expect, it } from 'vitest';

import {
    deriveSessionContentAvailability,
    isSessionContentReadable,
} from './encryptedContentAvailability';

describe('deriveSessionContentAvailability', () => {
    it('reads plain, opened and owner-compatibility Sessions as ready', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'not_required',
        })).toBe('ready');
        expect(deriveSessionContentAvailability({
            hydrationState: 'ready',
        })).toBe('ready');
        expect(deriveSessionContentAvailability({
            hydrationState: 'legacy_fallback_ready',
        })).toBe('ready');
    });

    it('waits for encrypted access when the recipient Account can receive keys', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'missing_envelope',
            recipientReadiness: { status: 'available' },
        })).toBe('encrypted_access_pending');
    });

    it('sends a keyless or recoverable Account to setup rather than repair', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'missing_envelope',
            recipientReadiness: { status: 'unavailable', reason: 'plain_account' },
        })).toBe('recipient_encryption_setup_required');
        expect(deriveSessionContentAvailability({
            hydrationState: 'missing_envelope',
            recipientReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
        })).toBe('recipient_encryption_setup_required');
    });

    it('sends an inconsistent Account binding to repair', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'missing_envelope',
            recipientReadiness: { status: 'unavailable', reason: 'encryption_inconsistent' },
        })).toBe('encrypted_access_needs_repair');
    });

    it('waits rather than accusing the Account when readiness is not yet known', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'missing_envelope',
        })).toBe('encrypted_access_pending');
    });

    it('treats an unopenable envelope as repair regardless of Account readiness', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'unopenable_envelope',
            recipientReadiness: { status: 'available' },
        })).toBe('encrypted_access_needs_repair');
        expect(deriveSessionContentAvailability({
            hydrationState: 'unopenable_envelope',
            recipientReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
        })).toBe('encrypted_access_needs_repair');
    });

    /**
     * The server cannot tell a structurally valid but cryptographically wrong envelope from a
     * correct one, and content that fails authentication after a successful open is not an
     * envelope problem. Reporting repair there would loop the user through a ceremony that
     * cannot help.
     */
    it('reports unavailable content when authentication fails after the key opened', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'ready',
            contentAuthenticationFailed: true,
        })).toBe('encrypted_content_unavailable');
        expect(deriveSessionContentAvailability({
            hydrationState: 'legacy_fallback_ready',
            contentAuthenticationFailed: true,
        })).toBe('encrypted_content_unavailable');
    });

    it('keeps a key-delivery failure distinct from a content failure', () => {
        expect(deriveSessionContentAvailability({
            hydrationState: 'unopenable_envelope',
            contentAuthenticationFailed: true,
        })).toBe('encrypted_access_needs_repair');
    });

    it('reports only ready as readable content', () => {
        expect(isSessionContentReadable('ready')).toBe(true);
        expect(isSessionContentReadable('encrypted_access_pending')).toBe(false);
        expect(isSessionContentReadable('recipient_encryption_setup_required')).toBe(false);
        expect(isSessionContentReadable('encrypted_access_needs_repair')).toBe(false);
        expect(isSessionContentReadable('encrypted_content_unavailable')).toBe(false);
    });
});
