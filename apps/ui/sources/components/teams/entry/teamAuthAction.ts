import type { AuthEntryProjectionV1 } from '@happier-dev/protocol';

import type { HomeAuthenticationAction } from '@/auth/capabilities/authMethodCapabilities';
import { projectAuthEntryMethodCapabilities } from '@/auth/capabilities/authMethodCapabilities';

import type { TeamAuthEntrySelection } from './TeamAuthEntrySurface';

/**
 * Converts one server-admitted Team auth action into the existing Home auth
 * execution contract. Team-origin OAuth receives Team context at its caller;
 * the provider and admission owners remain the same shared flow.
 */
export function projectTeamAuthSelection(
    selection: TeamAuthEntrySelection,
): HomeAuthenticationAction | null {
    const { action } = selection;
    const projection: Extract<AuthEntryProjectionV1, { state: 'ready' }> = {
        v: 1,
        state: 'ready',
        scope: { kind: 'home' },
        actions: [action],
        autoRedirect: null,
    };
    return projectAuthEntryMethodCapabilities(projection).authenticationActions[0] ?? null;
}
