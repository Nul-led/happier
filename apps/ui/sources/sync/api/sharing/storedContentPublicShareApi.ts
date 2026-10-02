import { StoredContentPublicShareAccessLogResponseV1Schema } from '@happier-dev/protocol';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { runWithServerRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { runWithServerAccountScopeRequestGuard } from '@/sync/runtime/orchestration/serverScopedRpc/serverAccountScopeRequestGuard';
import { HappyError } from '@/utils/errors/errors';

/** Owner audit reads use the same exact Account/Home transport as sharing mutations. */
export function createStoredContentPublicShareClient(scope: ServerAccountScope) {
    return {
        async listAccessLog(params: Readonly<{ shareId: string; signal?: AbortSignal; isCurrent?: () => boolean }>) {
            return runWithServerAccountScopeRequestGuard({ scope, signal: params.signal, isCurrent: params.isCurrent,
                staleError: () => new HappyError('stale_scope', false, { code: 'stale_scope' }),
            }, async ({ check, signal }) => runWithServerRequestAuthorityForServerAccountScope({ scope,
                activeRequest: async () => { throw new HappyError('stale_scope', false, { code: 'stale_scope' }); },
            }, async authority => {
                check();
                const response = await authority.request(`/v1/public-shares/${encodeURIComponent(params.shareId)}/access-log`, { signal });
                check();
                if (!response.ok) throw new HappyError('public_link_audit_unavailable', false, { status: response.status, code: 'public_link_audit_unavailable' });
                const result = StoredContentPublicShareAccessLogResponseV1Schema.parse(await response.json());
                check();
                return result;
            }));
        },
    };
}
