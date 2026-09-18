import type { TeamIdentityConnectionV1 } from '@happier-dev/protocol/teams';

import { t } from '@/text';

export type IdentityConnectionMode = 'sign_in_only' | 'sign_in_time_groups';
export type IdentityConnectionTestStatus = 'required' | 'stale' | 'current';

export function identityProviderKindLabel(kind: TeamIdentityConnectionV1['provider']['kind']): string {
    switch (kind) {
        case 'oidc': return t('identityAdministration.providerOidc');
        case 'workos_sso': return t('identityAdministration.providerWorkosSso');
        case 'github_app_identity': return t('identityAdministration.providerGitHub');
    }
}

/** WorkOS owns these wire strings and may add values independently. */
export function workosConnectionStrategyLabel(strategy: string): string {
    switch (strategy.trim().toLowerCase()) {
        case 'saml': return t('identityAdministration.workosStrategySaml');
        case 'oidc': return t('identityAdministration.workosStrategyOidc');
        default: return t('identityAdministration.workosStrategyOther');
    }
}

export function workosConnectionStatusLabel(status: string): string {
    switch (status.trim().toLowerCase()) {
        case 'active': return t('identityAdministration.active');
        case 'inactive':
        case 'disabled': return t('identityAdministration.disabled');
        case 'draft': return t('identityAdministration.githubDraft');
        default: return t('identityAdministration.workosStatusUnknown');
    }
}

/**
 * Keeps the overview stable under status and health changes. A status update
 * must not move the row currently under a pointer or keyboard focus.
 */
export function sortIdentityConnectionsForAdministration(
    connections: readonly TeamIdentityConnectionV1[],
): readonly TeamIdentityConnectionV1[] {
    return Object.freeze([...connections].sort((left, right) => {
        const byName = left.provider.displayName.localeCompare(right.provider.displayName);
        return byName !== 0 ? byName : left.id.localeCompare(right.id);
    }));
}

/**
 * OIDC Group claims are refreshed only during sign-in. Calling that directory
 * management would overstate offboarding and background synchronization.
 */
export function identityConnectionMode(connection: TeamIdentityConnectionV1): IdentityConnectionMode {
    if (
        connection.settings.kind === 'oidc'
        && (connection.settings.groupsAny.length > 0 || connection.settings.groupsAll.length > 0)
    ) {
        return 'sign_in_time_groups';
    }
    return 'sign_in_only';
}

/**
 * The exact connection, when its provider name alone does not identify it.
 *
 * Two connections may legitimately carry the same provider display name — two
 * WorkOS organizations, two GitHub installations — and a policy checkbox that
 * shows only that name would ask the administrator to choose blind. The
 * discriminator is taken from the connection projection already on screen; no
 * second identity read is introduced, and the opaque connection id is the
 * fallback because it is always exact.
 */
export function identityConnectionDiscriminator(connection: TeamIdentityConnectionV1): string {
    const reference = connection.externalReference;
    if (reference.kind === 'workos_sso' && reference.organizationId !== null) return reference.organizationId;
    if (reference.kind === 'github_app_identity') return reference.installationId;
    return connection.id;
}

export function identityConnectionTestStatus(
    connection: TeamIdentityConnectionV1,
): IdentityConnectionTestStatus {
    if (!connection.lastSuccessfulTest) return 'required';
    return connection.lastSuccessfulTest.current ? 'current' : 'stale';
}
