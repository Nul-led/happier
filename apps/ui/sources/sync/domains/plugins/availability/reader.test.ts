import { describe, expect, it } from 'vitest';

import {
    createPackageAssetArchiveV1,
    PluginAccountAvailabilityIntentReadResponseV1Schema,
    PluginMachineMaterializationV1Schema,
} from '@happier-dev/protocol/plugins/availability';

import {
    createPluginAccountAvailabilityReader,
    createPluginAccountAvailabilityReaderStore,
    type PluginAccountAvailabilitySnapshot,
} from './reader';

const scope = { serverId: 'srv-local-a', accountId: 'account-a' } as const;

const hostedSlot = {
    contributionId: 'hosted',
    tier: 'hostedWeb' as const,
    platform: 'web' as const,
};
const artifactDigest = `sha256:${'b'.repeat(64)}`;

function intentRead() {
    return PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
        availabilityCursor: 42,
        hostingCapability: {
            enabled: true,
            maxArtifactBytes: 1024,
            maxAccountBytes: 2048,
        },
        intent: {
            pluginId: 'com.acme.fixture',
            desiredVersion: '1.2.3',
            enabled: true,
            offlineUiHosting: 'enabled',
            writableCollections: [],
            revision: 'intent-1',
        },
        release: {
            ref: { pluginId: 'com.acme.fixture', version: '1.2.3' },
            archiveDigestSha256: `sha256:${'a'.repeat(64)}`,
            normalizedManifest: {
                schemaVersion: 2,
                id: 'com.acme.fixture',
                version: '1.2.3',
                displayName: 'Fixture',
                engines: { happier: '^1.0.0' },
                runtime: { apiVersion: 1 },
                contributes: {},
            },
            collectionContracts: [],
            uiSlots: [{
                ...hostedSlot,
                artifactId: 'hosted',
                artifactDigest,
                hostUiApiRange: '^1.0.0',
            }],
            packageAssetArchive: {
                archiveDigestSha256: `sha256:${'c'.repeat(64)}`,
                resources: [],
            },
        },
        packageAssets: [],
        uiArtifacts: [{
            release: { pluginId: 'com.acme.fixture', version: '1.2.3' },
            ...hostedSlot,
            artifactId: 'hosted',
            accountArtifactId: '00000000-0000-4000-8000-000000000001',
            artifactDigest,
            hostUiApiRange: '^1.0.0',
        }],
    });
}

function snapshot(overrides: Partial<PluginAccountAvailabilitySnapshot> = {}): PluginAccountAvailabilitySnapshot {
    const materialization = PluginMachineMaterializationV1Schema.parse({
        serverIdentityId: 'srv_fixture',
        machineId: 'machine-1',
        materializationId: 'install-1',
        pluginId: 'com.acme.fixture',
        version: '1.2.3',
        sourceClass: 'registryPackage',
        portableRelease: true,
        uiArtifacts: [{
            contributionId: 'hosted',
            artifactId: 'hosted',
            tier: 'hostedWeb',
            platform: 'web',
            artifactDigest: `sha256:${'a'.repeat(64)}`,
            hostUiApiRange: '^1.0.0',
        }],
        enabled: false,
        trustState: 'revoked',
        observedAt: 1_700_000_000_000,
    });
    return {
        availabilityCursor: 42,
        intentReads: [],
        materializations: [materialization],
        snapshots: [{
            serverIdentityId: materialization.serverIdentityId,
            machineId: materialization.machineId,
            materializations: [materialization],
        }],
        ...overrides,
    };
}

describe('Plugin Account Availability reader', () => {
    const machineBoundSlot = {
        pluginId: 'happier.fixture',
        contributionId: 'fixture-list-page-native',
        tier: 'reactNative' as const,
        platform: 'web' as const,
    };

    function machineBoundMaterialization(digest = `sha256:${'d'.repeat(64)}`) {
        return PluginMachineMaterializationV1Schema.parse({
            serverIdentityId: 'srv_fixture',
            machineId: 'machine-1',
            materializationId: 'bundled-fixture',
            pluginId: 'happier.fixture',
            version: '0.0.0',
            sourceClass: 'localPath',
            portableRelease: false,
            uiArtifacts: [{
                contributionId: 'fixture-list-page-native',
                artifactId: 'fixture-list-page-native',
                tier: 'reactNative',
                platform: 'web',
                artifactDigest: digest,
                hostUiApiRange: '^1.0.0',
            }],
            enabled: true,
            trustState: 'trusted',
            observedAt: 1_700_000_000_000,
        });
    }

    it('does not admit a slot from machine materialization alone without an Account release', () => {
        const reader = createPluginAccountAvailabilityReader({ scope, snapshot: snapshot() });

        expect(reader.readCurrentArtifact(machineBoundSlot)).toEqual({
            kind: 'unavailable',
            code: 'artifact_not_current',
        });
    });

    it('retires only named plugin authority without rewriting the separately owned machine snapshot', () => {
        const retiredPluginId = 'com.acme.retired';
        const retiredResponse = PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
            ...intentRead(),
            intent: { ...intentRead().intent!, pluginId: retiredPluginId },
            release: {
                ...intentRead().release!,
                ref: { pluginId: retiredPluginId, version: '1.2.3' },
                normalizedManifest: { ...intentRead().release!.normalizedManifest, id: retiredPluginId },
            },
            uiArtifacts: [],
        });
        const materializations = [machineBoundMaterialization()];
        const store = createPluginAccountAvailabilityReaderStore();
        store.replace({
            scope,
            snapshot: snapshot({
                intentReads: [
                    { pluginId: 'com.acme.fixture', response: intentRead() },
                    { pluginId: retiredPluginId, response: retiredResponse },
                ],
                materializations,
                snapshots: [{
                    serverIdentityId: materializations[0]!.serverIdentityId,
                    machineId: materializations[0]!.machineId,
                    materializations,
                }],
            }),
        });
        const reader = store.bind(scope);
        let notifications = 0;
        reader.subscribe(() => { notifications += 1; });

        store.retire([retiredPluginId]);

        expect(notifications).toBe(1);
        expect(reader.readCurrentSettingsDeclaration({ pluginId: retiredPluginId }))
            .toEqual({ kind: 'unavailable', code: 'artifact_not_current' });
        expect(reader.readCurrentArtifact({ pluginId: 'com.acme.fixture', ...hostedSlot }))
            .toMatchObject({ kind: 'available' });
        expect(reader.readMaterializations()).toMatchObject({
            kind: 'available',
            intentReads: [{ pluginId: 'com.acme.fixture' }],
            materializations,
            snapshots: [{ materializations }],
        });
    });

    it('projects only Account currentness/materialization facts and never a byte-source or renderer URL selector', () => {
        const reader = createPluginAccountAvailabilityReader({ scope, snapshot: snapshot() });

        expect(reader).not.toHaveProperty('readHostedWebArtifact');
        expect(reader.readMaterializations()).toMatchObject({
            kind: 'available',
            availabilityCursor: 42,
            materializations: [expect.objectContaining({
                materializationId: 'install-1',
                enabled: false,
                trustState: 'revoked',
            })],
        });
    });

    it('derives the current Artifact coordinate from the canonical intent-read response without granting a byte source', () => {
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: intentRead(),
                }],
            },
        });

        expect(reader.readCurrentArtifact({
            pluginId: 'com.acme.fixture',
            ...hostedSlot,
        })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
            artifact: expect.objectContaining({
                pluginId: 'com.acme.fixture',
                contributionId: 'hosted',
                tier: 'hostedWeb',
                platform: 'web',
                accountArtifactId: '00000000-0000-4000-8000-000000000001',
                artifactId: 'hosted',
                digest: artifactDigest,
                releaseVersion: '1.2.3',
            }),
        });
        expect(reader.readCurrentArtifact({
            pluginId: 'com.acme.fixture',
            ...hostedSlot,
        })).not.toHaveProperty('artifact.entryPath');
    });

    it('withholds Account-hosted provenance when hosting is unavailable or the intent opts out while preserving Artifact admission', () => {
        const response = intentRead();
        const intent = response.intent;
        if (!intent) throw new Error('Fixture requires a current intent.');
        for (const input of [
            { hostingCapability: { enabled: false as const }, offlineUiHosting: 'enabled' as const },
            { hostingCapability: response.hostingCapability, offlineUiHosting: 'disabled' as const },
        ]) {
            const reader = createPluginAccountAvailabilityReader({
                scope,
                snapshot: {
                    ...snapshot(),
                    intentReads: [{
                        pluginId: 'com.acme.fixture',
                        response: {
                            ...response,
                            hostingCapability: input.hostingCapability,
                            intent: { ...intent, offlineUiHosting: input.offlineUiHosting },
                        },
                    }],
                },
            });

            expect(reader.readCurrentArtifact({
                pluginId: 'com.acme.fixture',
                ...hostedSlot,
            })).toEqual({
                kind: 'available',
                availabilityCursor: 42,
                artifact: {
                    pluginId: 'com.acme.fixture',
                    contributionId: 'hosted',
                    artifactId: 'hosted',
                    tier: 'hostedWeb',
                    platform: 'web',
                    digest: artifactDigest,
                    hostUiApiRange: '^1.0.0',
                    releaseVersion: '1.2.3',
                },
            });
        }
    });

    it('admits only the current enabled release Package Asset descriptor without exposing its Artifact transport', () => {
        const response = intentRead();
        if (!response.release) throw new Error('Fixture requires a current release.');
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response,
                }],
            },
        });

        expect(reader.readCurrentPackageAsset({ pluginId: 'com.acme.fixture' })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
            packageAsset: {
                pluginId: 'com.acme.fixture',
                releaseVersion: '1.2.3',
                descriptor: response.release.packageAssetArchive,
            },
        });
        expect(reader.readCurrentPackageAsset({ pluginId: 'com.acme.fixture' }))
            .not.toHaveProperty('packageAsset.artifactId');
    });

    it('projects the selected package archive into hosting administration without requiring a UI slot', () => {
        const response = intentRead();
        if (!response.release) throw new Error('Fixture requires a release.');
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: snapshot({
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: { ...response, release: { ...response.release, uiSlots: [] }, uiArtifacts: [] },
                }],
            }),
        });
        expect(reader.readCurrentHostedArtifactAdministration({ pluginId: 'com.acme.fixture' }))
            .toMatchObject({
                kind: 'available',
                release: { packageAssetArchive: response.release.packageAssetArchive },
            });
    });

    it('admits package publication only for an enabled opted-in release with server hosting and no exact hosted archive', () => {
        const response = intentRead();
        if (!response.release || !response.intent) throw new Error('Fixture requires a selected release.');
        const manifest = {
            ...response.release.normalizedManifest,
            contributes: {
                resources: [{ id: 'mark', kind: 'asset', path: 'assets/mark.png', contentType: 'image/png' }],
            },
        };
        const archive = createPackageAssetArchiveV1({
            manifest,
            files: [{ path: 'assets/mark.png', bytes: new Uint8Array([1, 2, 3]) }],
        });
        if (!archive) throw new Error('Fixture requires a package archive.');
        const release = { ...response.release, normalizedManifest: manifest, packageAssetArchive: archive.descriptor, uiSlots: [] };
        const read = (overrides: Readonly<Record<string, unknown>> = {}) => createPluginAccountAvailabilityReader({
            scope,
            snapshot: snapshot({ intentReads: [{ pluginId: release.ref.pluginId, response:
                PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
                    ...response, release, uiArtifacts: [], packageAssets: [], ...overrides,
                }),
            }] }),
        }).readCurrentHostedPackageAssetPublicationTarget({ pluginId: release.ref.pluginId });

        expect(read()).toMatchObject({ kind: 'available', target: { release: release.ref, descriptor: archive.descriptor } });
        expect(read({ hostingCapability: { enabled: false } })).toMatchObject({ kind: 'unavailable' });
        expect(read({ intent: { ...response.intent, offlineUiHosting: 'disabled' } })).toMatchObject({ kind: 'unavailable' });
        expect(read({ intent: { ...response.intent, enabled: false } })).toMatchObject({ kind: 'unavailable' });
        expect(read({ packageAssets: [{
            release: release.ref,
            descriptor: archive.descriptor,
            artifactId: '00000000-0000-4000-8000-000000000002',
        }] })).toMatchObject({ kind: 'unavailable', code: 'artifact_already_hosted' });
    });

    it('admits the current normalized declaration for Account Settings even when activation is disabled', () => {
        const response = intentRead();
        if (!response.intent || !response.release) throw new Error('Fixture requires a current release.');
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: {
                        ...response,
                        intent: { ...response.intent, enabled: false },
                    },
                }],
            },
        });

        expect(reader.readCurrentSettingsDeclaration({ pluginId: 'com.acme.fixture' })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
            declaration: response.release.normalizedManifest,
        });
    });

    it('admits the current Account release selection with its CAS revision even while the release is disabled', () => {
        const response = intentRead();
        if (!response.intent || !response.release) throw new Error('Fixture requires a current release.');
        const disabledIntent = { ...response.intent, enabled: false };
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: {
                        ...response,
                        intent: disabledIntent,
                    },
                }],
            },
        });

        expect(reader.readCurrentReleaseSelection({ pluginId: 'com.acme.fixture' })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
            intent: disabledIntent,
            release: {
                ref: response.release.ref,
                normalizedManifest: response.release.normalizedManifest,
            },
        });
        expect(reader.readCurrentAccountDataCapability({ pluginId: 'com.acme.fixture' })).toEqual({
            kind: 'unavailable',
            code: 'account_data_not_current',
        });
    });

    it('projects only the exact immutable Collection ref admitted by the current release', () => {
        const ref = {
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
            schemaVersion: 2,
            contractDigest: 'A'.repeat(43),
        };
        const response = intentRead();
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: {
                        ...response,
                        release: response.release
                            ? { ...response.release, collectionContracts: [ref] }
                            : null,
                    },
                }],
            },
        });

        expect(reader.readCurrentCollectionContract({
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
        })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
            ref,
        });
        expect(reader.readCurrentCollectionContract({
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
        })).not.toHaveProperty('contract');
        expect(reader.readCurrentCollectionContract({
            pluginId: 'com.acme.fixture',
            collectionId: 'projects',
        })).toEqual({
            kind: 'unavailable',
            code: 'collection_not_current',
        });
    });

    it('admits the writer ref of a release-less daemon claim without selecting release UI', () => {
        const ref = {
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
            schemaVersion: 2,
            contractDigest: 'A'.repeat(43),
        };
        const response = intentRead();
        if (!response.intent) throw new Error('Fixture requires an intent.');
        const readerFor = (enabled: boolean) => createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: {
                        ...response,
                        intent: {
                            ...response.intent!,
                            desiredVersion: null,
                            enabled,
                            writableCollections: [ref],
                        },
                        release: null,
                        uiArtifacts: [],
                        packageAssets: [],
                    },
                }],
            },
        });

        expect(readerFor(true).readCurrentCollectionContract({
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
        })).toEqual({ kind: 'available', availabilityCursor: 42, ref });
        expect(readerFor(true).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({ kind: 'available', availabilityCursor: 42 });
        // The claim is the daemon-admitted plugin's Data authority, so its own
        // Account KV is admitted without a release declaration.
        expect(readerFor(true).readCurrentAccountKvCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({ kind: 'available', availabilityCursor: 42 });
        expect(readerFor(false).readCurrentAccountKvCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({ kind: 'unavailable', code: 'account_kv_not_current' });
        // A claim is Data authority only; release-selected UI stays unselected.
        expect(readerFor(true).readCurrentPackageAsset({
            pluginId: 'com.acme.fixture',
        })).toEqual({ kind: 'unavailable', code: 'artifact_not_current' });
        expect(readerFor(false).readCurrentCollectionContract({
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
        })).toEqual({ kind: 'unavailable', code: 'collection_not_current' });
    });

    it('admits Account Data rendering for either a Collection contract or declared Account KV', () => {
        const ref = {
            pluginId: 'com.acme.fixture',
            collectionId: 'tasks',
            schemaVersion: 2,
            contractDigest: 'A'.repeat(43),
        };
        const response = intentRead();
        const readerFor = (input: Readonly<{
            contracts: readonly typeof ref[];
            enabled?: boolean;
            accountStorage?: 'required' | 'optional';
        }>) => createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: {
                        ...response,
                        intent: response.intent
                            ? { ...response.intent, enabled: input.enabled ?? true }
                            : null,
                        release: response.release
                            ? {
                                ...response.release,
                                collectionContracts: input.contracts,
                                normalizedManifest: {
                                    ...response.release.normalizedManifest,
                                    hostAccess: {
                                        required: input.accountStorage === 'required'
                                            ? [{
                                                id: 'account-storage',
                                                capability: 'storage.account' as const,
                                                reason: 'Persist Account-scoped plugin state.',
                                                scope: { enabled: true as const },
                                            }]
                                            : [],
                                        optional: input.accountStorage === 'optional'
                                            ? [{
                                                id: 'optional-account-storage',
                                                capability: 'storage.account' as const,
                                                reason: 'Persist optional Account-scoped plugin state.',
                                                scope: { enabled: true as const },
                                            }]
                                            : [],
                                    },
                                },
                            }
                            : null,
                    },
                }],
            },
        });

        expect(readerFor({ contracts: [] }).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'unavailable',
            code: 'account_data_not_current',
        });
        expect(readerFor({ contracts: [ref] }).readCurrentAccountKvCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'unavailable',
            code: 'account_kv_not_current',
        });
        expect(readerFor({ contracts: [], accountStorage: 'required' }).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
        });
        expect(readerFor({ contracts: [], accountStorage: 'required' }).readCurrentAccountKvCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
        });
        expect(readerFor({ contracts: [], accountStorage: 'optional' }).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'unavailable',
            code: 'account_data_not_current',
        });
        // Read capability is release-declared, not inferred from the mutable
        // intent list. CAS remains Data-owned and can require a writable grant.
        expect(readerFor({ contracts: [ref] }).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'available',
            availabilityCursor: 42,
        });
        expect(readerFor({ contracts: [ref], enabled: false }).readCurrentAccountDataCapability({
            pluginId: 'com.acme.fixture',
        })).toEqual({
            kind: 'unavailable',
            code: 'account_data_not_current',
        });
    });

    it('derives exact Account-release correspondence from a strict materialization without electing a machine', () => {
        const response = intentRead();
        const currentRelease = response.release;
        if (!currentRelease) throw new Error('Fixture requires a current release.');
        const reader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: {
                ...snapshot(),
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response,
                }],
            },
        });
        const classifyRelease = reader.classifyRelease;
        const exact = {
            ...snapshot().materializations[0]!,
            enabled: true,
            trustState: 'trusted' as const,
            archiveDigestSha256: currentRelease.archiveDigestSha256,
            uiArtifacts: currentRelease.uiSlots.map((slot) => ({
                contributionId: slot.contributionId,
                artifactId: slot.artifactId,
                tier: slot.tier,
                platform: slot.platform,
                artifactDigest: slot.artifactDigest,
                hostUiApiRange: slot.hostUiApiRange,
            })),
        };
        const identity = {
            serverIdentityId: exact.serverIdentityId,
            materializationRef: {
                machineId: exact.machineId,
                materializationId: exact.materializationId,
                pluginId: exact.pluginId,
            },
        };

        expect(classifyRelease(exact)).toEqual({
            ...identity,
            releaseContent: 'matched',
            validation: { kind: 'admitted' },
        });
        for (const correspondenceMismatch of [
            PluginMachineMaterializationV1Schema.parse({
                ...exact,
                version: '1.2.4',
            }),
            PluginMachineMaterializationV1Schema.parse({
                ...exact,
                uiArtifacts: [{
                    ...exact.uiArtifacts[0]!,
                    artifactDigest: `sha256:${'c'.repeat(64)}`,
                }],
            }),
        ]) {
            expect(classifyRelease(correspondenceMismatch)).toEqual({
                ...identity,
                releaseContent: 'conflict',
                validation: { kind: 'admitted' },
            });
        }
        expect(classifyRelease({ ...exact, portableRelease: false })).toEqual({
            ...identity,
            releaseContent: 'unknown',
            validation: { kind: 'rejected', reason: 'unknown' },
        });
    });

    it('fails closed after the store moves to a different Account scope', () => {
        const store = createPluginAccountAvailabilityReaderStore();
        store.replace({ scope, snapshot: snapshot() });
        const reader = store.bind({ serverId: 'srv-local-a', accountId: 'account-b' });

        expect(reader.readMaterializations())
            .toEqual({ kind: 'unavailable', code: 'account_availability_scope_mismatch' });
    });

    it('replaces one complete materialization projection atomically', () => {
        const store = createPluginAccountAvailabilityReaderStore();
        store.replace({ scope, snapshot: snapshot() });
        const reader = store.bind(scope);

        expect(reader.readMaterializations()).toMatchObject({
            kind: 'available',
            availabilityCursor: 42,
        });
        store.replace({ scope, snapshot: snapshot({
            availabilityCursor: 43,
            materializations: [],
            snapshots: [],
        }) });
        expect(reader.readMaterializations()).toEqual({
            kind: 'available',
            availabilityCursor: 43,
            intentReads: [],
            materializations: [],
            snapshots: [],
        });
    });

    it('replaces successful plugin reads while failed siblings keep their prior content readable and flagged stale (AVD-07)', () => {
        const failedPluginId = 'com.acme.failed';
        const failedResponse = PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
            ...intentRead(),
            intent: { ...intentRead().intent!, pluginId: failedPluginId },
            release: {
                ...intentRead().release!,
                ref: { pluginId: failedPluginId, version: '1.2.3' },
                normalizedManifest: { ...intentRead().release!.normalizedManifest, id: failedPluginId },
            },
            uiArtifacts: [],
        });
        const store = createPluginAccountAvailabilityReaderStore();
        store.replace({
            scope,
            snapshot: snapshot({
                intentReads: [
                    { pluginId: 'com.acme.fixture', response: intentRead() },
                    { pluginId: failedPluginId, response: failedResponse },
                ],
            }),
        });
        const reader = store.bind(scope);

        store.replace({
            scope,
            snapshot: snapshot({
                availabilityCursor: 43,
                intentReads: [{
                    pluginId: 'com.acme.fixture',
                    response: PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
                        ...intentRead(),
                        availabilityCursor: 43,
                    }),
                }],
            }),
            failedPluginIds: [failedPluginId],
        });

        expect(reader.readCurrentArtifact({ pluginId: 'com.acme.fixture', ...hostedSlot }))
            .toMatchObject({ kind: 'available', availabilityCursor: 43 });
        // A transport/timeout/parse failure is not a withdrawal: the prior
        // confirmed selection stays usable and mounted UI is not revoked.
        expect(reader.readCurrentSettingsDeclaration({ pluginId: failedPluginId }))
            .toMatchObject({ kind: 'available' });
        expect(reader.readMaterializations()).toMatchObject({
            kind: 'available',
            intentReads: [{ pluginId: failedPluginId }, { pluginId: 'com.acme.fixture' }],
        });
        expect(store.getSnapshot()).toMatchObject({
            stalePluginIds: [failedPluginId],
            snapshot: { intentReads: [{ pluginId: failedPluginId }, { pluginId: 'com.acme.fixture' }] },
        });

        store.replace({
            scope,
            snapshot: snapshot({ availabilityCursor: 44, intentReads: [{ pluginId: failedPluginId, response: failedResponse }] }),
            failedPluginIds: [],
        });
        expect(reader.readCurrentSettingsDeclaration({ pluginId: failedPluginId }))
            .toMatchObject({ kind: 'available' });
        expect(store.getSnapshot()).toMatchObject({ stalePluginIds: [] });
    });

    it('snapshots caller-owned nested release, intent, and materialization facts at reader ingestion', () => {
        const response = intentRead();
        const intent = response.intent;
        const release = response.release;
        if (!intent || !release) throw new Error('Fixture requires a current intent and release.');
        const mutableResponse = {
            ...response,
            intent: {
                ...intent,
                writableCollections: [...intent.writableCollections],
            },
            release: {
                ...release,
                normalizedManifest: {
                    ...release.normalizedManifest,
                    engines: { ...release.normalizedManifest.engines },
                },
                collectionContracts: [...release.collectionContracts],
                uiSlots: release.uiSlots.map((slot) => ({
                    ...slot,
                })),
                packageAssetArchive: {
                    ...release.packageAssetArchive,
                    resources: [...release.packageAssetArchive.resources],
                },
            },
            uiArtifacts: response.uiArtifacts.map((artifact) => ({
                ...artifact,
                release: { ...artifact.release },
            })),
        };
        const mutableMaterializations = snapshot().materializations.map((materialization) => ({
            ...materialization,
            uiArtifacts: materialization.uiArtifacts.map((artifact) => ({ ...artifact })),
        }));
        const mutableSnapshot = {
            availabilityCursor: 42,
            intentReads: [{
                pluginId: 'com.acme.fixture',
                response: mutableResponse,
            }],
            materializations: mutableMaterializations,
            snapshots: [{
                serverIdentityId: 'srv_fixture',
                machineId: 'machine-1',
                materializations: mutableMaterializations,
            }],
        };
        const directReader = createPluginAccountAvailabilityReader({
            scope,
            snapshot: mutableSnapshot,
        });
        const store = createPluginAccountAvailabilityReaderStore();
        store.replace({ scope, snapshot: mutableSnapshot });
        const liveReader = store.bind(scope);

        // These mutations model the transport/projection owner reusing its
        // input graph after ingestion. Neither reader may silently adopt them
        // without a new Account Availability replacement/cursor notification.
        mutableResponse.intent.enabled = false;
        mutableResponse.intent.writableCollections.push({
            pluginId: 'com.acme.fixture',
            collectionId: 'mutated',
            schemaVersion: 1,
            contractDigest: 'm'.repeat(43),
        });
        mutableResponse.release.normalizedManifest.displayName = 'Mutated fixture';
        mutableResponse.release.uiSlots.splice(0, 1);
        mutableMaterializations[0]!.enabled = true;
        mutableMaterializations[0]!.uiArtifacts.splice(0, 1);

        for (const reader of [directReader, liveReader]) {
            expect(reader.readCurrentArtifact({
                pluginId: 'com.acme.fixture',
                ...hostedSlot,
            })).toMatchObject({
                kind: 'available',
                artifact: {
                    digest: artifactDigest,
                    releaseVersion: '1.2.3',
                },
            });
            expect(reader.readCurrentSettingsDeclaration({ pluginId: 'com.acme.fixture' }))
                .toMatchObject({
                    kind: 'available',
                    declaration: { displayName: 'Fixture' },
                });
            expect(reader.readMaterializations()).toMatchObject({
                kind: 'available',
                materializations: [{
                    enabled: false,
                    uiArtifacts: [{ contributionId: 'hosted' }],
                }],
                snapshots: [{
                    materializations: [{
                        enabled: false,
                        uiArtifacts: [{ contributionId: 'hosted' }],
                    }],
                }],
            });
        }
    });
});
