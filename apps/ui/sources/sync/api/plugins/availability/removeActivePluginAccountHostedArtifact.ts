import {
    PluginAvailabilityActionHttpPathsV1,
    PluginAvailabilityUiArtifactRemoveActionInputV1Schema,
    PluginAvailabilityUiArtifactRemoveActionOutputV1Schema,
    type PluginAvailabilityUiArtifactRemoveActionInputV1,
} from '@happier-dev/protocol/plugins/availability';

import { apiSocket } from '@/sync/api/session/apiSocket';
import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { captureSessionRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope';

type Snapshot = Readonly<{ serverId: string | null; generation: number }>;
type Authority = Readonly<{
    request: (path: string, init?: RequestInit) => Promise<Response>;
    release?: () => Promise<void>;
}>;

export type ActivePluginAccountHostedArtifactRemoverDependencies = Readonly<{
    getServerSnapshot: () => Snapshot;
    captureRequestAuthority: (scope: ServerAccountScope) => Promise<Authority>;
}>;

export type ActivePluginAccountHostedArtifactRemoveResult =
    | Readonly<{ kind: 'removed' }>
    | Readonly<{ kind: 'unavailable' }>;

const defaultDependencies: ActivePluginAccountHostedArtifactRemoverDependencies = {
    getServerSnapshot: () => {
        const snapshot = getActiveServerSnapshot();
        return { serverId: snapshot.serverId, generation: snapshot.generation };
    },
    captureRequestAuthority: async (scope) => {
        const authority = await captureSessionRequestAuthorityForServerAccountScope({
            scope,
            activeRequest: (path, init) => apiSocket.request(path, init),
        });
        return Object.freeze({ request: authority.request, release: authority.release });
    },
};

function isCurrent(
    lifetime: ActiveServerAccountScopeLifetime,
    snapshot: Snapshot,
    getSnapshot: () => Snapshot,
): boolean {
    const current = getSnapshot();
    return lifetime.isCurrent()
        && snapshot.serverId === lifetime.scope.serverId
        && current.serverId === snapshot.serverId
        && current.generation === snapshot.generation;
}

/** Exact qualified-link removal; Availability remains the link and Artifact owner. */
export function createActivePluginAccountHostedArtifactRemover(
    overrides: Partial<ActivePluginAccountHostedArtifactRemoverDependencies> = {},
): Readonly<{
    remove: (input: Readonly<{
        accountLifetime: ActiveServerAccountScopeLifetime;
        target: PluginAvailabilityUiArtifactRemoveActionInputV1;
    }>) => Promise<ActivePluginAccountHostedArtifactRemoveResult>;
}> {
    const dependencies = { ...defaultDependencies, ...overrides };
    return Object.freeze({
        remove: async ({ accountLifetime, target }) => {
            const parsed = PluginAvailabilityUiArtifactRemoveActionInputV1Schema.safeParse(target);
            if (!parsed.success) return Object.freeze({ kind: 'unavailable' as const });
            const snapshot = dependencies.getServerSnapshot();
            if (!isCurrent(accountLifetime, snapshot, dependencies.getServerSnapshot)) {
                return Object.freeze({ kind: 'unavailable' as const });
            }
            const controller = new AbortController();
            const retirement = accountLifetime.onRetire(() => controller.abort());
            let authority: Authority | null = null;
            try {
                authority = await dependencies.captureRequestAuthority(accountLifetime.scope);
                if (!isCurrent(accountLifetime, snapshot, dependencies.getServerSnapshot)) {
                    return Object.freeze({ kind: 'unavailable' as const });
                }
                const response = await authority.request(
                    PluginAvailabilityActionHttpPathsV1['account.plugins.availability.uiArtifact.remove'],
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(parsed.data),
                        signal: controller.signal,
                    },
                );
                const raw = await response.json().catch(() => null);
                const output = PluginAvailabilityUiArtifactRemoveActionOutputV1Schema.safeParse(raw);
                if (
                    !response.ok
                    || !isCurrent(accountLifetime, snapshot, dependencies.getServerSnapshot)
                    || !output.success
                    || output.data.link.release.pluginId !== parsed.data.release.pluginId
                    || output.data.link.release.version !== parsed.data.release.version
                    || output.data.link.contributionId !== parsed.data.contributionId
                    || output.data.link.tier !== parsed.data.tier
                    || output.data.link.platform !== parsed.data.platform
                ) {
                    return Object.freeze({ kind: 'unavailable' as const });
                }
                return Object.freeze({ kind: 'removed' as const });
            } catch {
                return Object.freeze({ kind: 'unavailable' as const });
            } finally {
                retirement.dispose();
                await authority?.release?.();
            }
        },
    });
}

const installedRemover = createActivePluginAccountHostedArtifactRemover();

export async function removeActivePluginAccountHostedArtifact(input: Parameters<typeof installedRemover.remove>[0]) {
    return await installedRemover.remove(input);
}
