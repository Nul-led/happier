import type { Session } from '@/sync/domains/state/storageTypes';

export type TranscriptInteraction = Readonly<{
    canSendMessages: boolean;
    canApprovePermissions: boolean;
    /** Action grant for creating a fork from this transcript surface. Missing grants fail closed. */
    canFork?: boolean;
    /** Grant for opening session/workspace file surfaces. Missing grants fail closed. */
    canOpenFiles?: boolean;
    /** Grant for resolving and opening session media previews. Missing grants fail closed. */
    canPreviewMedia?: boolean;
    permissionDisabledReason?: 'public' | 'readOnly' | 'notGranted' | 'inactive';
    disableToolNavigation?: boolean;
}>;

/**
 * Known write denial for one exact Session — the opposite question from
 * {@link deriveTranscriptInteraction}'s `canSendMessages`.
 *
 * `canSendMessages` fails closed, which is correct before mutating: an
 * unloaded Session, an absent access projection or an offline Home all read as
 * "cannot send". That answer must not decide whether an affordance is offered,
 * because it would take composing away from a writer whose Session simply has
 * not loaded yet. This returns `true` only when the exact Session's own access
 * projection states the capability is denied; everything else stays enabled
 * with the server as the authority.
 */
export function isSessionWriteKnownDenied(
    session: Readonly<{ access?: Session['access'] }> | null | undefined,
): boolean {
    return session?.access?.capabilities.submitAgentInput === false;
}

export function deriveTranscriptInteractionFromSession(
    session: Readonly<{
        access?: Session['access'];
        active?: boolean | null | undefined;
        presence?: 'online' | number | null | undefined;
        disableToolNavigation?: boolean;
    }>,
): TranscriptInteraction {
    // Treat `session.active` as the source of truth. When `active` is missing/unknown, be conservative
    // and treat the session as inactive for interaction surfaces like permission approvals.
    const isSessionActive = session.active === true;

    return deriveTranscriptInteraction({
        kind: 'session',
        access: session.access,
        isSessionActive,
        disableToolNavigation: session.disableToolNavigation,
    });
}

export function deriveTranscriptInteraction(
    input:
        | Readonly<{
              kind: 'session';
              access?: Session['access'];
              isSessionActive?: boolean | null | undefined;
              disableToolNavigation?: boolean;
          }>
        | Readonly<{
              kind: 'public';
              disableToolNavigation?: boolean;
          }>,
): TranscriptInteraction {
    if (input.kind === 'public') {
        return {
            canSendMessages: false,
            canApprovePermissions: false,
            canFork: false,
            canOpenFiles: false,
            canPreviewMedia: false,
            permissionDisabledReason: 'public',
            disableToolNavigation: input.disableToolNavigation,
        };
    }

    const canSendMessages = input.access?.capabilities.submitAgentInput === true;
    const baseCanApprovePermissions = input.access?.capabilities.approveRuntimePermissions === true;
    const isSessionActive = input.isSessionActive !== false;
    const canApprovePermissions = baseCanApprovePermissions && isSessionActive;
    const permissionDisabledReason: TranscriptInteraction['permissionDisabledReason'] = !isSessionActive
        ? 'inactive'
        : canApprovePermissions
            ? undefined
            : input.access?.level === 'view'
                ? 'readOnly'
                : 'notGranted';

    return {
        canSendMessages,
        canApprovePermissions,
        canFork: canSendMessages,
        canOpenFiles: input.access?.capabilities.readTranscript === true,
        canPreviewMedia: input.access?.capabilities.readTranscript === true,
        permissionDisabledReason,
        disableToolNavigation: input.disableToolNavigation,
    };
}
