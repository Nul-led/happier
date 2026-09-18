/**
 * Home Administration destinations.
 *
 * Every path carries the Home's own id, so a screen opened here stays bound to
 * that Home for its whole lifetime and a change of focused Home elsewhere in the
 * app cannot retarget it.
 */
/**
 * The Home selector. It is the only Home Administration destination without a
 * Home in its path, because choosing one is exactly what it is for.
 */
export function homeAdministrationHomesPath(): string {
    return '/settings/home';
}

export function homeAdministrationOverviewPath(serverId: string): string {
    return `${homeAdministrationHomesPath()}/${encodeURIComponent(serverId)}`;
}

export function homeAdministrationPeoplePath(serverId: string): string {
    return `${homeAdministrationOverviewPath(serverId)}/people`;
}

export function homeAdministrationAccountPath(serverId: string, accountId: string): string {
    return `${homeAdministrationPeoplePath(serverId)}/${encodeURIComponent(accountId)}`;
}

/**
 * Team administration for one Home. It is a Home Administration destination
 * rather than the person's own Teams list: the authority comes from the Home
 * role, and the Teams shown are the Home's, not the viewer's memberships.
 */
export function homeAdministrationTeamsPath(serverId: string): string {
    return `${homeAdministrationOverviewPath(serverId)}/teams`;
}

export function homeAdministrationPoliciesPath(serverId: string): string {
    return `${homeAdministrationOverviewPath(serverId)}/policies`;
}

export function homeAdministrationIdentityProviderCreatePath(serverId: string): string {
    return `${homeAdministrationPoliciesPath(serverId)}/identity/new`;
}

export function homeAdministrationIdentityProviderPath(serverId: string, providerId: string): string {
    return `${homeAdministrationPoliciesPath(serverId)}/identity/${encodeURIComponent(providerId)}`;
}

export function homeAdministrationIdentityProviderEditPath(serverId: string, providerId: string): string {
    return `${homeAdministrationIdentityProviderPath(serverId, providerId)}/edit`;
}

export function homeAdministrationGitHubAppCreatePath(serverId: string): string {
    return `${homeAdministrationPoliciesPath(serverId)}/github-apps/new`;
}

export function homeAdministrationGitHubAppPath(serverId: string, registrationId: string): string {
    return `${homeAdministrationPoliciesPath(serverId)}/github-apps/${encodeURIComponent(registrationId)}`;
}

export function homeAdministrationGitHubAppEditPath(serverId: string, registrationId: string): string {
    return `${homeAdministrationGitHubAppPath(serverId, registrationId)}/edit`;
}
