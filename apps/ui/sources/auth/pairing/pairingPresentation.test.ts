import { describe, expect, it } from 'vitest';

import { resolveHomeEnrollmentPresentation } from './pairingPresentation';

describe('resolveHomeEnrollmentPresentation', () => {
    it.each([
        ['generating', 'generating', 'common.loading', 'none', 'none', 'polite'],
        ['ready', 'ready', 'connect.addPhoneQrInstructions', 'target_and_expiry', 'none', 'polite'],
        ['adding', 'adding', 'connect.securingCredentials', 'target_and_requester', 'none', 'polite'],
        ['retryable_error', 'retryable_error', 'connect.homeEnrollmentRetryBody', 'target_and_requester', 'automatic_retry', 'polite'],
        ['expired', 'expired', 'connect.pairingQrExpired', 'target_and_expiry', 'create_new_qr', 'assertive'],
        ['invalid_request', 'invalid_request', 'errors.operationFailed', 'none', 'create_new_qr', 'assertive'],
        ['succeeded', 'succeeded', 'common.success', 'target_and_requester', 'none', 'polite'],
    ] as const)(
        'maps trusted-display %s without exposing protocol mechanics',
        (phase, semanticPhase, primaryTranslationKey, contextualFacts, recoveryAction, liveRegion) => {
            expect(resolveHomeEnrollmentPresentation({ kind: 'trusted_home_display', phase })).toEqual({
                phase: semanticPhase,
                primaryTranslationKey,
                contextualFacts,
                recoveryAction,
                liveRegion,
                activity: phase === 'generating' || phase === 'adding' || phase === 'retryable_error',
            });
        },
    );

    it.each([
        [{ phase: 'generating' }, 'generating', 'common.loading', 'none', 'none'],
        [{ phase: 'ready' }, 'ready', 'connect.showRequesterQrInstructions', 'target_and_expiry', 'none'],
        [{ phase: 'adding' }, 'adding', 'connect.securingCredentials', 'target_and_expiry', 'none'],
        [{ phase: 'retryable_error', partialCommit: false }, 'retryable_error', 'connect.homeEnrollmentRetryBody', 'target', 'retry'],
        [{ phase: 'retryable_error', partialCommit: true }, 'partial_commit', 'connect.homeEnrollmentPartialCommitBody', 'target', 'none'],
        [{ phase: 'expired' }, 'expired', 'connect.pairingQrExpired', 'target', 'retry'],
        [{ phase: 'invalid' }, 'invalid_request', 'connect.scanComputerQrUnavailableBody', 'target', 'retry'],
        [{ phase: 'update_required' }, 'invalid_request', 'connect.updateRequiredBody', 'target', 'none'],
        [{ phase: 'succeeded' }, 'succeeded', 'connect.homeAddedPreservedFocusBody', 'target', 'none'],
    ] as const)(
        'maps requester-display %s to one semantic presentation model',
        (source, semanticPhase, primaryTranslationKey, contextualFacts, recoveryAction) => {
            expect(resolveHomeEnrollmentPresentation({ kind: 'requester_display', ...source })).toMatchObject({
                phase: semanticPhase,
                primaryTranslationKey,
                contextualFacts,
                recoveryAction,
            });
        },
    );

    it.each([
        ['idle', 'ready', 'connect.scanComputerQrInstructions', 'none', false],
        ['requesting', 'verifying', 'common.loading', 'target_and_expiry', true],
        ['securing', 'adding', 'connect.securingCredentials', 'target_and_expiry', true],
    ] as const)(
        'maps scanner phase %s while leaving the scanner workflow owner distinct',
        (phase, semanticPhase, primaryTranslationKey, contextualFacts, activity) => {
            expect(resolveHomeEnrollmentPresentation({ kind: 'scanner', phase })).toMatchObject({
                phase: semanticPhase,
                primaryTranslationKey,
                contextualFacts,
                activity,
            });
        },
    );

    it('keeps a terminal success authoritative over a later transient scanner phase', () => {
        expect(resolveHomeEnrollmentPresentation({
            kind: 'scanner',
            phase: 'requesting',
            result: 'succeeded',
        })).toMatchObject({
            phase: 'succeeded',
            primaryTranslationKey: 'connect.homeAddedPreservedFocusBody',
            recoveryAction: 'none',
            activity: false,
        });
    });

    it('preserves partial commit as a terminal recovery state', () => {
        expect(resolveHomeEnrollmentPresentation({
            kind: 'scanner',
            phase: 'securing',
            result: 'partial_commit',
        })).toMatchObject({
            phase: 'partial_commit',
            primaryTranslationKey: 'connect.homeEnrollmentPartialCommitBody',
            contextualFacts: 'target',
            recoveryAction: 'none',
            liveRegion: 'assertive',
        });
    });
});
