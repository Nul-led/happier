import { describe, expect, it, vi } from 'vitest';

import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

import { createActivePluginAccountHostedArtifactRemover } from './removeActivePluginAccountHostedArtifact';

const scope = { serverId: 'server-a', accountId: 'account-a' } as const;
const target = {
    release: { pluginId: 'example.tasks', version: '2.0.0' },
    contributionId: 'tasks-ui',
    tier: 'hostedWeb' as const,
    platform: 'web' as const,
};

function lifetime(): ActiveServerAccountScopeLifetime {
    return Object.freeze({
        scope,
        isCurrent: () => true,
        onRetire: () => Object.freeze({ dispose: () => {} }),
    });
}

function response(overrides: Readonly<Record<string, unknown>> = {}) {
    return new Response(JSON.stringify({
        removed: true,
        link: {
            release: target.release,
            contributionId: target.contributionId,
            tier: target.tier,
            platform: target.platform,
            artifactId: '00000000-0000-4000-8000-000000000001',
            artifactDigest: `sha256:${'a'.repeat(64)}`,
            compatibility: {
                hostAppVersion: '2.0.0', hostUiApiVersion: '1.0.0', reactVersion: '19.2.0',
                platform: 'web', channel: 'store', nativeCapabilities: [],
            },
            ...overrides,
        },
    }), { status: 200 });
}

describe('active plugin Account hosted Artifact remover', () => {
    it('accepts only the exact qualified link returned by Availability', async () => {
        const request = vi.fn(async () => response());
        const remover = createActivePluginAccountHostedArtifactRemover({
            getServerSnapshot: () => ({ serverId: scope.serverId, generation: 3 }),
            captureRequestAuthority: async () => ({ request }),
        });

        await expect(remover.remove({ accountLifetime: lifetime(), target })).resolves.toEqual({ kind: 'removed' });
        expect(request).toHaveBeenCalledWith(
            expect.stringContaining('ui-artifacts/remove'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify(target) }),
        );
    });

    it('fails closed when the response names a different qualified slot', async () => {
        const remover = createActivePluginAccountHostedArtifactRemover({
            getServerSnapshot: () => ({ serverId: scope.serverId, generation: 3 }),
            captureRequestAuthority: async () => ({ request: async () => response({ contributionId: 'other-ui' }) }),
        });

        await expect(remover.remove({ accountLifetime: lifetime(), target })).resolves.toEqual({ kind: 'unavailable' });
    });
});
