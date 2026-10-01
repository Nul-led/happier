import type { HomeRoleV1 } from '@happier-dev/protocol/home/governance';

import type { HomeAdministrationBinding } from './useHomeAdministration';

/** Resolves the same viewer fact for surfaces already bound to this exact Home. */
export function resolveHomeViewerRole(binding: HomeAdministrationBinding): HomeRoleV1 | null {
    if (binding.kind !== 'bound' || binding.state.kind !== 'ready') return null;
    if (binding.state.projection.setupState === 'setup_required') return null;
    return binding.state.projection.viewer.homeRole;
}
