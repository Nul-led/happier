import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

import { SESSION_BOARD_DESTINATION } from './sessionBoardDestination';

/**
 * The ONE Session Board admission decision.
 *
 * `sessions.board` is the single feature decision for the whole Session Board
 * product — the Board itself AND the viewer-local Companion that presents Board
 * items beside Chat. Companion has no feature bit of its own: it is a placement
 * for Board content plus the first-party Session Summary, so a Home that does
 * not serve Board serves no Companion either.
 *
 * Every entry point (Session header, reserved rail, Companion host, presentation
 * bridge, Details/sidebar Board hosts, and the mobile Cockpit catalog/screen)
 * resolves availability here, against the EXACT Session's Home rather than an
 * ambient selection, and fails closed: a missing, malformed or refused decision
 * is `false`.
 */
export function useSessionBoardFeatureEnabled(serverId: string | null | undefined): boolean {
    return useFeatureEnabled(SESSION_BOARD_DESTINATION.featureId, {
        scopeKind: 'spawn',
        serverId,
    });
}
