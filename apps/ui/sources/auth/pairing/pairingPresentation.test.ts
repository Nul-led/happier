import { describe, expect, it } from 'vitest';

import { formatPairingCountdown, resolveHomeEnrollmentPresentation } from './pairingPresentation';

describe('resolveHomeEnrollmentPresentation', () => {
    it.each([
        ['generating', 'generating', 'common.loading', 'none', 'none', 'polite'],
        ['ready', 'ready', 'connect.addPhoneQrInstructions', 'target_and_expiry', 'none', 'polite'],
        ['adding', 'adding', 'connect.securingCredentials', 'target_and_requester', 'none', 'polite'],
        ['retryable_error', 'retryable_error', 'connect.homeEnrollmentRetryBody', 'target_and_requester', 'automatic_retry', 'polite'],
        ['expired', 'expired', 'connect.pairingQrExpired', 'target_and_expiry', 'create_new_qr', 'assertive'],
        ['invalid_request', 'invalid_request', 'errors.operationFailed', 'none', 'create_new_qr', 'assertive'],
        ['update_required', 'update_required', 'connect.updateRequiredBody', 'none', 'none', 'assertive'],
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
        [{ phase: 'expired' }, 'expired', 'connect.pairingQrExpired', 'target', 'create_new_qr'],
        [{ phase: 'invalid' }, 'invalid_request', 'connect.scanComputerQrUnavailableBody', 'target', 'create_new_qr'],
        [{ phase: 'update_required' }, 'update_required', 'connect.updateRequiredBody', 'target', 'none'],
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
            direction: 'trusted_home_displays',
        })).toMatchObject({
            phase: 'succeeded',
            primaryTranslationKey: 'connect.homeAddedPreservedFocusBody',
            recoveryAction: 'none',
            activity: false,
        });
    });

    it('describes reverse-direction success from the approving Home\'s perspective', () => {
        expect(resolveHomeEnrollmentPresentation({
            kind: 'scanner',
            phase: 'requesting',
            result: 'succeeded',
            direction: 'requester_displays',
        })).toMatchObject({
            phase: 'succeeded',
            primaryTranslationKey: 'connect.requesterDeviceAddedBody',
            recoveryAction: 'none',
            activity: false,
        });
    });

    // Every terminal result the approver branch publishes speaks to the approver;
    // none may fall through to joiner/restore guidance.
    it.each([
        ['retryable_error', 'connect.requesterDeviceRetryBody', 'retry'],
        ['wrong_target', 'connect.requesterDeviceWrongHomeBody', 'retry'],
        ['expired', 'connect.requesterDeviceQrExpiredBody', 'retry'],
        ['invalid_request', 'connect.requesterDeviceRequestInvalidBody', 'retry'],
    ] as const)('describes reverse-direction %s from the approving Home\'s perspective', (result, primaryTranslationKey, recoveryAction) => {
        const joinerPresentation = resolveHomeEnrollmentPresentation({
            kind: 'scanner',
            phase: 'requesting',
            result,
            direction: 'trusted_home_displays',
        });
        const approverPresentation = resolveHomeEnrollmentPresentation({
            kind: 'scanner',
            phase: 'requesting',
            result,
            direction: 'requester_displays',
        });

        expect(approverPresentation).toEqual({ ...joinerPresentation, primaryTranslationKey, recoveryAction });
        expect(approverPresentation.primaryTranslationKey).not.toBe(joinerPresentation.primaryTranslationKey);
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

describe('formatPairingCountdown', () => {
    it('counts down to the invite expiry as m:ss, rounding up so it never reads 0:00 while the code still works', () => {
        const now = 1_000_000;
        expect(formatPairingCountdown(now + 272_000, now)).toBe('4:32');
        expect(formatPairingCountdown(now + 60_000, now)).toBe('1:00');
        expect(formatPairingCountdown(now + 9_001, now)).toBe('0:10');
        expect(formatPairingCountdown(now + 400, now)).toBe('0:01');
    });

    it('reads 0:00 once the invite has expired', () => {
        expect(formatPairingCountdown(5_000, 9_000)).toBe('0:00');
    });
});
