import { dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
    resolveFirstPartyInstallLayout,
    resolveFirstPartyVersionRootIdentity,
} from '@happier-dev/cli-common/firstPartyRuntime';
import { PUBLIC_RELEASE_RING_IDS } from '@happier-dev/release-runtime/releaseRings';

import {
    type BundledFirstPartyPluginSourceCustodyV1,
    type ManagedPluginSourceCustodyV1,
    type PluginSourceCustodyV1,
} from '@happier-dev/protocol';

import { isCanonicalAbsolutePathInsideRoot } from '@/utils/path/expandHomeDirPath';
import { resolveAuthoritativePackagedRuntimeCustody } from '@/packagedRuntime/resolvePackagedRuntimeEntrypoint';
import { resolvePublishedPinnedRunnerSnapshotById } from '@happier-dev/cli-common/pinnedRunnerSnapshot';
import { BUNDLED_FIRST_PARTY_PLUGIN_LOCATORS } from '../projection/registry/sources/generatedBundledPluginManifests';
import { readPluginManifest } from '../manifest/read';
import type { PluginStorePaths } from '../store/paths';
import type { AgentSessionRunnerBindingV1 } from './runner/agentSessionRunnerFactoryBinding';
import { createAgentSessionRunnerFactoryBinding } from './runner/agentSessionRunnerFactoryBinding';
import { readRetainedBundledAgentFactory } from './retainedBundledAgentFactory';
import {
    assertContainedRegularGenerationFile,
    readPreparedImmutablePluginGeneration,
} from '../store/registry/generationStore';

export type RetainedBundledPluginRoot = Readonly<{
    rootPath: string;
    cacheIdentity: string;
}>;

/** A pinned runner's attested source may supersede a daemon-current bootstrap source. */
export function runnerPinnedBundledCustodyCanSupersedeBootstrap(
    bootstrapCustody: PluginSourceCustodyV1,
    attestedCustody: PluginSourceCustodyV1,
): boolean {
    return bootstrapCustody.kind === 'bundled_first_party'
        && bootstrapCustody.packagedRuntime.kind === 'pinned_runner_snapshot'
        && attestedCustody.kind === 'bundled_first_party'
        && attestedCustody.packagedRuntime.kind === 'pinned_runner_snapshot';
}

/** Bundled dependencies execute from the same retained package root as their runner. */
export function selectRunnerManagedDependencySourceCustody(
    runnerCustody: PluginSourceCustodyV1,
    registeredCustody: PluginSourceCustodyV1,
): PluginSourceCustodyV1 {
    return registeredCustody.kind === 'bundled_first_party'
        && runnerCustody.kind === 'bundled_first_party'
        ? runnerCustody
        : registeredCustody;
}

/** The runner's pinned publication owns its bundled Agent declaration and version. */
export async function attestFreshRunnerAgentBinding(params: Readonly<{
    binding: AgentSessionRunnerBindingV1;
    paths: PluginStorePaths;
    runnerSnapshotIdentity: string;
    moduleUrl?: string;
}>): Promise<AgentSessionRunnerBindingV1> {
    const custody = params.binding.sourceCustody;
    if (
        custody.kind !== 'bundled_first_party'
        || custody.packagedRuntime.kind !== 'pinned_runner_snapshot'
    ) return params.binding;
    const snapshotId = params.runnerSnapshotIdentity.startsWith('snapshot:')
        ? params.runnerSnapshotIdentity.slice('snapshot:'.length)
        : '';
    if (!snapshotId || snapshotId.includes('/') || snapshotId.includes('\\')) {
        throw new Error('Runner Agent bundled source has no pinned snapshot identity');
    }
    const runnerCustody = Object.freeze({
        kind: 'bundled_first_party' as const,
        packagedRuntime: Object.freeze({
            kind: 'pinned_runner_snapshot' as const,
            snapshotId,
        }),
    });
    const source = await attestRetainedPluginSource({
        paths: params.paths,
        pluginId: params.binding.pluginId,
        custody: runnerCustody,
        resolveBundledPluginRoot: (input) => resolveRetainedBundledPluginRoot({
            ...input,
            ...(params.moduleUrl ? { moduleUrl: params.moduleUrl } : {}),
        }),
    });
    if (!source.manifest.contributes.agents.some(
        (agent) => agent.id === params.binding.localAgentId,
    )) {
        throw new Error('Runner Agent bundled source has no admitted Agent declaration');
    }
    if ('kind' in params.binding) {
        return Object.freeze({
            ...params.binding,
            pluginVersion: source.manifest.version,
            sourceCustody: runnerCustody,
        });
    }
    const factory = readRetainedBundledAgentFactory(
        source.manifest,
        params.binding.localAgentId,
    );
    return createAgentSessionRunnerFactoryBinding({
        ...params.binding,
        pluginVersion: source.manifest.version,
        sourceCustody: runnerCustody,
        locator: factory.locator,
        normalizedModulePath: factory.normalizedModulePath,
        loadMode: factory.loadMode,
    });
}

export function retainedAgentSourceMatchesRunner(
    runnerSnapshotIdentity: string,
    binding: AgentSessionRunnerBindingV1,
): boolean {
    const custody = binding.sourceCustody;
    if (custody.kind !== 'bundled_first_party') return true;
    return custody.packagedRuntime.kind === 'pinned_runner_snapshot'
        ? runnerSnapshotIdentity === `snapshot:${custody.packagedRuntime.snapshotId}`
        : runnerSnapshotIdentity === `version:${custody.packagedRuntime.versionRootId}`;
}

/** A current registration supplies policy; the retained runner supplies its own attested code. */
export function currentAgentBindingMatchesRetainedRunner(params: Readonly<{
    runnerSnapshotIdentity: string;
    currentBinding: AgentSessionRunnerBindingV1;
    retainedBinding: AgentSessionRunnerBindingV1;
}>): boolean {
    if (!retainedAgentSourceMatchesRunner(
        params.runnerSnapshotIdentity,
        params.retainedBinding,
    )) return false;
    const currentCustody = params.currentBinding.sourceCustody;
    const retainedCustody = params.retainedBinding.sourceCustody;
    if (
        currentCustody.kind === 'bundled_first_party'
        && retainedCustody.kind === 'bundled_first_party'
    ) {
        return params.currentBinding.pluginId === params.retainedBinding.pluginId
            && params.currentBinding.agentId === params.retainedBinding.agentId
            && params.currentBinding.localAgentId === params.retainedBinding.localAgentId;
    }
    return isDeepStrictEqual(params.currentBinding, params.retainedBinding);
}

export async function resolveRetainedBundledPluginRoot(params: Readonly<{
    pluginId: string;
    custody: BundledFirstPartyPluginSourceCustodyV1;
    moduleUrl?: string;
    processEnv?: NodeJS.ProcessEnv;
}>): Promise<RetainedBundledPluginRoot> {
    const moduleUrl = params.moduleUrl ?? import.meta.url;
    const packagedRuntime = params.custody.packagedRuntime;
    const authoritativeRuntime = resolveAuthoritativePackagedRuntimeCustody({
        moduleUrl,
        ...(params.processEnv ? { processEnv: params.processEnv } : {}),
    });
    const expectedIdentity = packagedRuntime.kind === 'pinned_runner_snapshot'
        ? packagedRuntime.snapshotId
        : packagedRuntime.versionRootId;
    if (!authoritativeRuntime) {
        throw new Error('Retained bundled source custody does not match the executing packaged runtime');
    }
    let runtimeRoot = authoritativeRuntime.root;
    if (packagedRuntime.kind === 'pinned_runner_snapshot') {
        if (authoritativeRuntime.packagedRuntime.kind !== 'pinned_runner_snapshot') {
            throw new Error('Retained bundled runner snapshot has no authoritative snapshot store');
        }
        const snapshotsDir = dirname(await realpath(authoritativeRuntime.root));
        const location = resolvePublishedPinnedRunnerSnapshotById(
            join(authoritativeRuntime.root, 'package-dist', 'index.mjs'),
            packagedRuntime.snapshotId,
            { snapshotsDir },
        );
        if (!location || dirname(await realpath(location.snapshotRoot)) !== snapshotsDir) {
            throw new Error('Retained bundled runner snapshot is unavailable or untrusted');
        }
        runtimeRoot = location.snapshotRoot;
    } else {
        if (authoritativeRuntime.packagedRuntime.kind !== 'cli_version_root') {
            throw new Error('Retained bundled source custody does not match the executing packaged runtime');
        }
        const processEnv = params.processEnv ?? process.env;
        const retainedVersionRoot = PUBLIC_RELEASE_RING_IDS.flatMap((channel) => {
            const layout = resolveFirstPartyInstallLayout({
                componentId: 'happier-cli',
                channel,
                processEnv,
            });
            try {
                resolveFirstPartyVersionRootIdentity({
                    layout,
                    runtimeRoot: authoritativeRuntime.root,
                });
                return [resolveFirstPartyVersionRootIdentity({
                    layout,
                    runtimeRoot: join(layout.versionsDir, packagedRuntime.versionRootId),
                }).root];
            } catch {
                return [];
            }
        })[0];
        if (!retainedVersionRoot) {
            throw new Error('Retained bundled source custody does not match an available packaged version root');
        }
        runtimeRoot = retainedVersionRoot;
    }
    const locator = BUNDLED_FIRST_PARTY_PLUGIN_LOCATORS.find(
        (candidate) => candidate.pluginId === params.pluginId,
    );
    if (!locator || locator.sourceSpec.kind !== 'bundled' || !locator.sourceSpec.locator.trim()) {
        throw new Error('Retained bundled source custody names an unknown first-party plugin');
    }
    const packageRoot = await realpath(join(
        runtimeRoot,
        'node_modules',
        ...locator.sourceSpec.locator.split('/'),
    ));
    const canonicalRuntimeRoot = await realpath(runtimeRoot);
    if (!isCanonicalAbsolutePathInsideRoot(canonicalRuntimeRoot, packageRoot)) {
        throw new Error('Retained bundled plugin root escapes its packaged runtime custody');
    }
    return Object.freeze({
        rootPath: packageRoot,
        cacheIdentity: `${packagedRuntime.kind}:${expectedIdentity}`,
    });
}

type RetainedPluginSourceCustody =
    | ManagedPluginSourceCustodyV1
    | BundledFirstPartyPluginSourceCustodyV1;

export type RetainedPluginSourceAttestation = Readonly<{
    rootPath: string;
    cacheIdentity: string;
    manifestAuthority: 'external' | 'bundled_first_party';
    manifest: Extract<
        Awaited<ReturnType<typeof readPluginManifest>>,
        Readonly<{ ok: true }>
    >['manifest'];
    managedGeneration: Awaited<ReturnType<typeof readPreparedImmutablePluginGeneration>> | null;
    assertStillAvailable(): Promise<void>;
}>;

/** Attests restart-stable managed or bundled custody without interpreting a contribution family. */
export async function attestRetainedPluginSource(params: Readonly<{
    paths: PluginStorePaths;
    pluginId: string;
    custody: RetainedPluginSourceCustody;
    manifestAuthority?: 'external' | 'bundled_first_party';
    resolveBundledPluginRoot?: typeof resolveRetainedBundledPluginRoot;
}>): Promise<RetainedPluginSourceAttestation> {
    const generation = params.custody.kind === 'managed'
        ? await readPreparedImmutablePluginGeneration({
            paths: params.paths,
            immutableGenerationId: params.custody.immutableGenerationId,
        })
        : null;
    if (generation && generation.record.pluginId !== params.pluginId) {
        throw new Error('Retained plugin source custody identity mismatch');
    }
    const bundledRoot = params.custody.kind === 'bundled_first_party'
        ? await (params.resolveBundledPluginRoot ?? resolveRetainedBundledPluginRoot)({
            pluginId: params.pluginId,
            custody: params.custody,
        })
        : null;
    if (generation) {
        await assertContainedRegularGenerationFile(
            generation.rootPath,
            generation.record.manifestRelativePath,
            'Retained plugin generation manifest',
        );
    }
    const rootPath = await realpath(generation?.rootPath ?? bundledRoot!.rootPath);
    const manifestAuthority = params.custody.kind === 'bundled_first_party'
        ? 'bundled_first_party' as const
        : params.manifestAuthority ?? 'external' as const;
    const manifest = await readPluginManifest({
        manifestPath: generation
            ? join(rootPath, ...generation.record.manifestRelativePath.split('/'))
            : join(rootPath, '.happier-plugin', 'plugin.json'),
        manifestAuthority,
        sourceProvenance: generation?.record.sourceProvenance ?? 'localSource',
    });
    if (!manifest.ok || manifest.manifest.id !== params.pluginId) {
        throw new Error('Retained plugin immutable declaration source mismatch');
    }
    return Object.freeze({
        rootPath,
        cacheIdentity: generation
            ? `managed:${generation.record.immutableGenerationId}`
            : bundledRoot!.cacheIdentity,
        manifestAuthority,
        manifest: manifest.manifest,
        managedGeneration: generation,
        assertStillAvailable: async () => {
            if (generation) {
                const current = await readPreparedImmutablePluginGeneration({
                    paths: params.paths,
                    immutableGenerationId: generation.record.immutableGenerationId,
                });
                if (current.record.pluginId !== params.pluginId) {
                    throw new Error('Retained plugin source custody identity changed during attestation');
                }
                return;
            }
            const resolved = await (params.resolveBundledPluginRoot
                ?? resolveRetainedBundledPluginRoot)({
                pluginId: params.pluginId,
                custody: params.custody as BundledFirstPartyPluginSourceCustodyV1,
            });
            if (
                resolved.cacheIdentity !== bundledRoot!.cacheIdentity
                || await realpath(resolved.rootPath) !== rootPath
            ) {
                throw new Error('Retained bundled source custody changed during attestation');
            }
        },
    });
}
