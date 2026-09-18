import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

export type HomeEnrollmentPresentationPhase =
    | 'generating'
    | 'ready'
    | 'verifying'
    | 'adding'
    | 'retryable_error'
    | 'expired'
    | 'invalid_request'
    | 'succeeded'
    | 'partial_commit';

export type HomeEnrollmentPresentationModel = Readonly<{
    phase: HomeEnrollmentPresentationPhase;
    primaryTranslationKey:
        | 'common.loading'
        | 'common.success'
        | 'connect.addPhoneQrInstructions'
        | 'connect.homeAddedPreservedFocusBody'
        | 'connect.homeEnrollmentPartialCommitBody'
        | 'connect.homeEnrollmentRetryBody'
        | 'connect.pairingQrExpired'
        | 'connect.scanComputerQrInstructions'
        | 'connect.scanComputerQrUnavailableBody'
        | 'connect.securingCredentials'
        | 'connect.showRequesterQrInstructions'
        | 'connect.updateRequiredBody'
        | 'errors.operationFailed';
    contextualFacts: 'none' | 'target' | 'target_and_expiry' | 'target_and_requester';
    recoveryAction: 'none' | 'automatic_retry' | 'retry' | 'create_new_qr';
    liveRegion: 'none' | 'polite' | 'assertive';
    activity: boolean;
}>;

type HomeEnrollmentPresentationSource =
    | Readonly<{
        kind: 'trusted_home_display';
        phase: 'generating' | 'ready' | 'adding' | 'retryable_error' | 'expired' | 'invalid_request' | 'succeeded';
    }>
    | Readonly<{
        kind: 'requester_display';
        phase: 'generating' | 'ready' | 'adding' | 'retryable_error' | 'expired' | 'invalid' | 'update_required' | 'succeeded';
        partialCommit?: boolean;
    }>
    | Readonly<{
        kind: 'scanner';
        phase: 'idle' | 'requesting' | 'securing';
        result?: 'succeeded' | 'partial_commit' | 'retryable_error' | 'expired' | 'invalid_request';
    }>;

const TERMINAL_SCANNER_PRESENTATIONS: Readonly<Record<
    NonNullable<Extract<HomeEnrollmentPresentationSource, { kind: 'scanner' }>['result']>,
    HomeEnrollmentPresentationModel
>> = {
    succeeded: {
        phase: 'succeeded',
        primaryTranslationKey: 'connect.homeAddedPreservedFocusBody',
        contextualFacts: 'target',
        recoveryAction: 'none',
        liveRegion: 'polite',
        activity: false,
    },
    partial_commit: {
        phase: 'partial_commit',
        primaryTranslationKey: 'connect.homeEnrollmentPartialCommitBody',
        contextualFacts: 'target',
        recoveryAction: 'none',
        liveRegion: 'assertive',
        activity: false,
    },
    retryable_error: {
        phase: 'retryable_error',
        primaryTranslationKey: 'connect.homeEnrollmentRetryBody',
        contextualFacts: 'target',
        recoveryAction: 'retry',
        liveRegion: 'polite',
        activity: false,
    },
    expired: {
        phase: 'expired',
        primaryTranslationKey: 'connect.pairingQrExpired',
        contextualFacts: 'target',
        recoveryAction: 'retry',
        liveRegion: 'assertive',
        activity: false,
    },
    invalid_request: {
        phase: 'invalid_request',
        primaryTranslationKey: 'connect.scanComputerQrUnavailableBody',
        contextualFacts: 'target',
        recoveryAction: 'retry',
        liveRegion: 'assertive',
        activity: false,
    },
};

/**
 * Pure semantic projection shared by the three QR surfaces. It deliberately
 * contains no transport, protocol, secret, or workflow state ownership.
 */
export function resolveHomeEnrollmentPresentation(
    source: HomeEnrollmentPresentationSource,
): HomeEnrollmentPresentationModel {
    if (source.kind === 'scanner') {
        if (source.result) return TERMINAL_SCANNER_PRESENTATIONS[source.result];
        if (source.phase === 'idle') {
            return {
                phase: 'ready',
                primaryTranslationKey: 'connect.scanComputerQrInstructions',
                contextualFacts: 'none',
                recoveryAction: 'none',
                liveRegion: 'none',
                activity: false,
            };
        }
        return {
            phase: source.phase === 'requesting' ? 'verifying' : 'adding',
            primaryTranslationKey: source.phase === 'requesting' ? 'common.loading' : 'connect.securingCredentials',
            contextualFacts: 'target_and_expiry',
            recoveryAction: source.phase === 'requesting' ? 'automatic_retry' : 'none',
            liveRegion: 'polite',
            activity: true,
        };
    }

    if (source.kind === 'requester_display') {
        if (source.phase === 'generating') {
            return {
                phase: 'generating', primaryTranslationKey: 'common.loading', contextualFacts: 'none',
                recoveryAction: 'none', liveRegion: 'polite', activity: true,
            };
        }
        if (source.phase === 'ready') {
            return {
                phase: 'ready', primaryTranslationKey: 'connect.showRequesterQrInstructions', contextualFacts: 'target_and_expiry',
                recoveryAction: 'none', liveRegion: 'polite', activity: false,
            };
        }
        if (source.phase === 'adding') {
            return {
                phase: 'adding', primaryTranslationKey: 'connect.securingCredentials', contextualFacts: 'target_and_expiry',
                recoveryAction: 'none', liveRegion: 'polite', activity: true,
            };
        }
        if (source.phase === 'retryable_error') {
            return source.partialCommit
                ? {
                    phase: 'partial_commit', primaryTranslationKey: 'connect.homeEnrollmentPartialCommitBody', contextualFacts: 'target',
                    recoveryAction: 'none', liveRegion: 'assertive', activity: false,
                }
                : {
                    phase: 'retryable_error', primaryTranslationKey: 'connect.homeEnrollmentRetryBody', contextualFacts: 'target',
                    recoveryAction: 'retry', liveRegion: 'polite', activity: false,
                };
        }
        if (source.phase === 'expired') {
            return {
                phase: 'expired', primaryTranslationKey: 'connect.pairingQrExpired', contextualFacts: 'target',
                recoveryAction: 'retry', liveRegion: 'assertive', activity: false,
            };
        }
        if (source.phase === 'invalid') {
            return {
                phase: 'invalid_request', primaryTranslationKey: 'connect.scanComputerQrUnavailableBody', contextualFacts: 'target',
                recoveryAction: 'retry', liveRegion: 'assertive', activity: false,
            };
        }
        if (source.phase === 'update_required') {
            return {
                phase: 'invalid_request', primaryTranslationKey: 'connect.updateRequiredBody', contextualFacts: 'target',
                recoveryAction: 'none', liveRegion: 'assertive', activity: false,
            };
        }
        return {
            phase: 'succeeded', primaryTranslationKey: 'connect.homeAddedPreservedFocusBody', contextualFacts: 'target',
            recoveryAction: 'none', liveRegion: 'polite', activity: false,
        };
    }

    if (source.phase === 'generating') {
        return {
            phase: 'generating', primaryTranslationKey: 'common.loading', contextualFacts: 'none',
            recoveryAction: 'none', liveRegion: 'polite', activity: true,
        };
    }
    if (source.phase === 'ready') {
        return {
            phase: 'ready', primaryTranslationKey: 'connect.addPhoneQrInstructions', contextualFacts: 'target_and_expiry',
            recoveryAction: 'none', liveRegion: 'polite', activity: false,
        };
    }
    if (source.phase === 'adding' || source.phase === 'retryable_error') {
        return {
            phase: source.phase,
            primaryTranslationKey: source.phase === 'retryable_error' ? 'connect.homeEnrollmentRetryBody' : 'connect.securingCredentials',
            contextualFacts: 'target_and_requester',
            recoveryAction: source.phase === 'adding' ? 'none' : 'automatic_retry',
            liveRegion: 'polite',
            activity: true,
        };
    }
    if (source.phase === 'expired') {
        return {
            phase: 'expired', primaryTranslationKey: 'connect.pairingQrExpired', contextualFacts: 'target_and_expiry',
            recoveryAction: 'create_new_qr', liveRegion: 'assertive', activity: false,
        };
    }
    if (source.phase === 'invalid_request') {
        return {
            phase: 'invalid_request', primaryTranslationKey: 'errors.operationFailed', contextualFacts: 'none',
            recoveryAction: 'create_new_qr', liveRegion: 'assertive', activity: false,
        };
    }
    return {
        phase: 'succeeded', primaryTranslationKey: 'common.success', contextualFacts: 'target_and_requester',
        recoveryAction: 'none', liveRegion: 'polite', activity: false,
    };
}

export function formatHomeEnrollmentTargetLabel(descriptor: HomeConnectionDescriptorV1): string {
    try {
        return new URL(descriptor.canonicalServerUrl).host;
    } catch {
        return descriptor.canonicalServerUrl;
    }
}

export function formatEnrollmentExpiry(expiresAtMs: number): string {
    return new Date(expiresAtMs).toLocaleString();
}
