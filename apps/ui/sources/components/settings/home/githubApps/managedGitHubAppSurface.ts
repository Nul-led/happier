import type { ManagedGitHubAppOwnerV1 } from '@happier-dev/protocol';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';

/**
 * Everything the shared GitHub App list, detail and editor need in order to
 * serve one owner.
 *
 * A Team-owned App is the same registration record as a Home-owned one, read
 * and written through the same Actions; only the owner and the destinations
 * differ. Passing them in keeps one composition rather than letting each
 * administration tree grow its own idea of what a verified installation is.
 */
export type ManagedGitHubAppSurface = Readonly<{
    scope: ServerAccountScope;
    owner: ManagedGitHubAppOwnerV1;
    mutationsAvailable: boolean;
    onApprovalPending?: (registration: ActionApprovalRegistration) => void;
    routes: Readonly<{
        detail: (registrationId: string) => string;
        edit: (registrationId: string) => string;
        /** Canonical identity administration owner for this App's scope. */
        signIn: string;
        /** Present only when one exact Team owns the directory destination. */
        directory?: string;
    }>;
    /**
     * Present only when this surface owns the Home policy that can approve a
     * GitHub Enterprise origin. Team-owned Apps deliberately omit it: their
     * administration tree must not manufacture Home authority or navigation.
     */
    githubEnterpriseOriginPolicyPath?: string;
}>;
