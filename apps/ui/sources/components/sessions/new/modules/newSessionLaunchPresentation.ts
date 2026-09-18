import type { TemporaryComputerLaunchStatus } from '@/components/sessions/new/hooks/useTemporaryComputerLaunch';

import {
    isNewSessionLaunchAttemptPendingBeforeSession,
    type NewSessionLaunchAttempt,
} from './newSessionLaunchAttempt';

/**
 * Which launch presentation — if any — owns the New Session screen right now.
 *
 * `machine` is the compact ordinary pending card that sits with the composer.
 * `temporary_computer` is the blocking waiting surface that freezes the whole
 * authoring variant.
 */
export type NewSessionLaunchPresentation = 'none' | 'machine' | 'temporary_computer';

/**
 * The one decision about which launch presentation is active.
 *
 * Both authoring layouts used to answer this question for themselves, and the
 * Temporary-computer path publishes an ordinary pending launch attempt *and*
 * sets `isCreating` while its own blocking surface is up — so one launch grew
 * two pending presentations, the second one stranded behind an inert,
 * accessibility-hidden authoring tree. The two presentations are mutually
 * exclusive by construction here instead of coincidentally in two components.
 *
 * A prompt with nothing in it is not worth previewing: the compact card exists
 * to show the author the request they just sent.
 */
export function resolveNewSessionLaunchPresentation(input: Readonly<{
    temporaryComputerLaunchStatus: TemporaryComputerLaunchStatus;
    isCreating: boolean;
    pendingLaunchAttempt: NewSessionLaunchAttempt | null | undefined;
}>): NewSessionLaunchPresentation {
    if (input.temporaryComputerLaunchStatus !== 'idle') return 'temporary_computer';
    if (!input.isCreating) return 'none';
    const attempt = input.pendingLaunchAttempt;
    if (!isNewSessionLaunchAttemptPendingBeforeSession(attempt)) return 'none';
    return attempt.prompt.displayText.trim().length > 0 || attempt.prompt.prompt.trim().length > 0
        ? 'machine'
        : 'none';
}
