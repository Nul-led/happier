import * as React from 'react';
import { useRouter } from 'expo-router';

import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';
import { Item } from '@/components/ui/lists/Item';
import { t } from '@/text';

import type { ManagedGitHubAppSurface } from './managedGitHubAppSurface';

const ORIGIN_NOT_APPROVED = 'github_enterprise_origin_not_approved';

/**
 * The GitHub App surface adds exactly one explanation the shared identity
 * classifier cannot give — an origin this Home has not approved — and defers
 * every other code to it.
 *
 * Falling back to the raw code, as this did, put a server enum in front of an
 * administrator for any outcome the GitHub screens had not enumerated; the
 * shared owner already answers those in the person's language.
 */
export function managedGitHubAppFailureMessage(code: string): string {
    return code === ORIGIN_NOT_APPROVED
        ? t('identityAdministration.githubEnterpriseOriginNotApproved')
        : identityAdministrationFailureMessage(code);
}

/**
 * The recovery action for a Home-owned GitHub Enterprise origin refusal.
 *
 * The server remains the policy authority. This item only carries the person
 * to the existing exact-Home Policies screen; it is intentionally absent for
 * Team-owned registrations, whose Home-policy recovery is owned elsewhere.
 */
export const ManagedGitHubAppFailureRecovery = React.memo(function ManagedGitHubAppFailureRecovery(
    props: Readonly<{ code: string; surface: ManagedGitHubAppSurface }>,
) {
    const router = useRouter();
    const path = props.code === ORIGIN_NOT_APPROVED
        ? props.surface.githubEnterpriseOriginPolicyPath
        : undefined;
    if (!path) return null;
    return (
        <Item
            testID="github-enterprise-origin-policy"
            title={t('homeGovernance.githubEnterpriseOrigins')}
            subtitle={t('homeGovernance.policies')}
            onPress={() => router.push(path)}
        />
    );
});
