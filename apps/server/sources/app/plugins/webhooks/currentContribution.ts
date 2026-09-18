import { PluginManifestV2Schema } from '@happier-dev/protocol';

import type { Tx } from '@/storage/inTx';

import type {
    ResolvedPluginWebhookContributionV1,
    ResolvedPluginWebhookTargetV1,
} from './endpointStore';

export type CurrentPluginWebhookClaimAuthorityV1 = Readonly<{
    materializationId: string;
    pluginId: string;
    version: string;
    contribution: ResolvedPluginWebhookContributionV1;
}>;

function projectCurrentPluginWebhookContributionsV1(params: Readonly<{
    pluginId: string;
    version: string;
    intent: Readonly<{ enabled: boolean; desiredVersion: string | null }> | null | undefined;
    normalizedManifest: unknown;
}>): readonly ResolvedPluginWebhookContributionV1[] {
    if (!params.intent?.enabled || params.intent.desiredVersion !== params.version) return [];
    const manifest = PluginManifestV2Schema.safeParse(params.normalizedManifest);
    if (!manifest.success || manifest.data.id !== params.pluginId) return [];
    return manifest.data.contributes.webhooks.map((contribution) => Object.freeze({
        pluginId: manifest.data.id,
        localId: contribution.id,
        handlerActionLocalId: contribution.handlerAction.localId,
        verifierKind: contribution.verifier.kind,
        routingKind: contribution.verifier.routing,
    }));
}

/**
 * Resolves every current webhook contribution for Availability-classified
 * targets in fixed database work. Claim selection uses this projection to skip
 * any number of rows whose frozen contribution is no longer executable.
 */
export async function resolveCurrentPluginWebhookClaimAuthoritiesTxV1(params: Readonly<{
    tx: Tx;
    accountId: string;
    targets: readonly Readonly<{
        materializationId: string;
        pluginId: string;
        version: string;
    }>[];
}>): Promise<readonly CurrentPluginWebhookClaimAuthorityV1[]> {
    if (params.targets.length === 0) return [];
    const pluginIds = [...new Set(params.targets.map((target) => target.pluginId))];
    const releaseRefs = [...new Map(params.targets.map((target) => [
        `${target.pluginId}\0${target.version}`,
        { pluginId: target.pluginId, version: target.version },
    ])).values()];
    const [intents, releases] = await Promise.all([
        params.tx.accountPluginIntent.findMany({
            where: {
                accountId: params.accountId,
                pluginId: { in: pluginIds },
            },
            select: { pluginId: true, enabled: true, desiredVersion: true },
        }),
        params.tx.accountPluginRelease.findMany({
            where: {
                accountId: params.accountId,
                OR: releaseRefs,
            },
            select: { pluginId: true, version: true, normalizedManifest: true },
        }),
    ]);
    const intentsByPluginId = new Map(intents.map((intent) => [intent.pluginId, intent] as const));
    const releasesByRef = new Map(releases.map((release) => [
        `${release.pluginId}\0${release.version}`,
        release,
    ] as const));
    return params.targets.flatMap((target) => {
        const intent = intentsByPluginId.get(target.pluginId);
        const release = releasesByRef.get(`${target.pluginId}\0${target.version}`);
        if (!release) return [];
        return projectCurrentPluginWebhookContributionsV1({
            pluginId: target.pluginId,
            version: target.version,
            intent,
            normalizedManifest: release.normalizedManifest,
        }).map((contribution) => Object.freeze({
            materializationId: target.materializationId,
            pluginId: target.pluginId,
            version: target.version,
            contribution,
        }));
    });
}

/** Canonical current-manifest resolver shared by endpoint correspondence and claimed dispatch. */
export async function resolveCurrentPluginWebhookContributionTxV1(params: Readonly<{
    tx: Tx;
    accountId: string;
    contribution: Readonly<{ pluginId: string; localId: string }>;
    target: ResolvedPluginWebhookTargetV1;
}>): Promise<ResolvedPluginWebhookContributionV1 | null> {
    if (params.contribution.pluginId !== params.target.materialization.pluginId) return null;
    const [intent, release] = await Promise.all([
        params.tx.accountPluginIntent.findUnique({
            where: {
                accountId_pluginId: {
                    accountId: params.accountId,
                    pluginId: params.contribution.pluginId,
                },
            },
            select: { enabled: true, desiredVersion: true },
        }),
        params.tx.accountPluginRelease.findUnique({
            where: {
                accountId_pluginId_version: {
                    accountId: params.accountId,
                    pluginId: params.contribution.pluginId,
                    version: params.target.pluginVersion,
                },
            },
            select: { normalizedManifest: true },
        }),
    ]);
    if (!release) return null;
    const contribution = projectCurrentPluginWebhookContributionsV1({
        pluginId: params.contribution.pluginId,
        version: params.target.pluginVersion,
        intent,
        normalizedManifest: release.normalizedManifest,
    }).find(
        (candidate) => candidate.localId === params.contribution.localId,
    );
    return contribution ?? null;
}
