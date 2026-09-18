import type { RunnerActivationProjectionV1 } from '@happier-dev/protocol/ephemeralRunner/projection';

import { isLaunchProfileIncompatibility } from '../modules/profileHelpers';
import type { TemporaryComputerLaunchStatus } from './useTemporaryComputerLaunch';

/**
 * What a dismissal gesture — Escape, Android Back, a route change or a backdrop
 * press — is allowed to do to a Temporary-computer launch attempt.
 *
 * Deliberately has no `cancel` arm. A live activation is a real package that may
 * already be sitting on someone else's computer, so revoking it is an explicit
 * decision the user makes through Cancel, never a side effect of navigating
 * away. Leaving the composer keeps the waiting draft and its activation exactly
 * where the Drafts group and the next reopen can find them.
 */
export type TemporaryComputerLaunchDismissal =
    | 'none'
    | 'acknowledge_terminal'
    | 'leave_composer';

export function resolveTemporaryComputerLaunchDismissal(input: Readonly<{
    status: TemporaryComputerLaunchStatus;
    projectionState: RunnerActivationProjectionV1['state'] | null;
}>): TemporaryComputerLaunchDismissal {
    if (input.status === 'idle') return 'none';
    // A server-acknowledged close has nothing left to preserve; dismissing it is
    // the same acknowledgement the surface's Done action performs.
    if (input.projectionState === 'closed') return 'acknowledge_terminal';
    // A deterministic authoring incompatibility never produced a package either,
    // so the gesture performs the same Return to editing the surface offers
    // rather than navigating away from a request the user still has to fix.
    if (input.projectionState === null && isLaunchProfileIncompatibility(input.status)) {
        return 'acknowledge_terminal';
    }
    return 'leave_composer';
}
