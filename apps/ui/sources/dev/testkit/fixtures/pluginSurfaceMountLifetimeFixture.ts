import { createBoundPluginSurfaceController } from '@/components/plugins/surfaces/boundPluginSurfaceController';

/** A physical renderer lifetime supplied by the real incumbent mount owner. */
export function createPluginSurfaceMountLifetimeFixture(accountId = 'account-a') {
    return createBoundPluginSurfaceController({
        facts: {
            pluginId: 'acme.preview',
            contributionId: 'preview-web',
            surfaceId: 'fixture-hosted-surface',
            placement: 'sessionPane',
            platform: 'web',
            interactionEnabled: false,
            daemonInteractionEnabled: false,
            accountLifetime: {
                scope: { serverId: 'server-a', accountId },
                isCurrent: () => true,
                onRetire: () => ({ dispose: () => {} }),
            },
        },
    });
}
