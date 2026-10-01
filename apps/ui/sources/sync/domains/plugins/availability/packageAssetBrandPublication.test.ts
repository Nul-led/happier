import { describe, expect, it, vi } from 'vitest';

// HTTP and machine RPC below are the only external systems in this composed path.
vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { request: vi.fn() } }));

import {
    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
    PluginProjectionV2Schema,
    PluginManifestV2Schema,
    createAccountScopedCryptoMaterialSnapshotV1,
    convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1,
} from '@happier-dev/protocol';
import {
    createPackageAssetArchiveV1,
    PluginAccountAvailabilityIntentReadResponseV1Schema,
    PluginAvailabilityActionHttpPathsV1,
    PluginAvailabilityPackageAssetPublishActionInputV1Schema,
    PluginAvailabilityPackageAssetReadActionOutputV1Schema,
    PluginReleaseFactsV1Schema,
    type PluginAvailabilityPackageAssetReadActionOutputV1,
    type PluginMachineMaterializationV1,
} from '@happier-dev/protocol/plugins/availability';

import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { readInstalledPluginBrandPresentation } from '@/components/plugins/shared/installedPluginBrandPresentation';
import type { PluginSurfaceResourceReadTransport } from '@/components/plugins/surfaces/pluginSurfaceResourceRead';
import { createValidPluginBrandPngFixture } from '@/dev/testkit';
import { encodeBase64 } from '@/encryption/base64';
import { createActivePluginAccountPackageAssetSource } from '@/sync/api/plugins/availability/activePluginAccountPackageAssetRead';
import { createLifetime, createPublisher } from '@/sync/api/plugins/availability/activePluginAccountHostedArtifactPublish.testkit';

import { acquireAndPublishPluginAccountPackageAssets } from './accountPackageAssetPublication';
import { createPluginAccountAvailabilityReader, createPluginAccountAvailabilityReaderStore } from './reader';

describe('portable brand publication and daemon-offline consumption', () => {
    it.each(['plain', 'e2ee'] as const)('publishes only after opt-in, then a fresh %s client opens the brand with no daemon', async (mode) => {
        const scope = { serverId: 'server-a', accountId: 'account-a' } as const;
        const active = createLifetime(scope);
        const pluginId = 'acme.portable-brand';
        const bytes = createValidPluginBrandPngFixture();
        const manifest = {
            schemaVersion: 2, id: pluginId, version: '1.0.0', displayName: 'Portable brand',
            engines: { happier: '^1.0.0' }, runtime: { apiVersion: 1 },
            brand: { iconResourceId: 'brand' },
            contributes: { resources: [{ id: 'brand', kind: 'asset', path: 'assets/brand.png', contentType: 'image/png' }] },
        };
        PluginManifestV2Schema.parse(manifest);
        const archive = createPackageAssetArchiveV1({ manifest, files: [{ path: 'assets/brand.png', bytes }] });
        if (!archive) throw new Error('Expected canonical packaged brand archive.');
        const resource = archive.descriptor.resources[0]!;
        const release = PluginReleaseFactsV1Schema.parse({
            ref: { pluginId, version: manifest.version }, archiveDigestSha256: `sha256:${'a'.repeat(64)}`,
            normalizedManifest: manifest, collectionContracts: [], uiSlots: [], packageAssetArchive: archive.descriptor,
        });
        const materialization: PluginMachineMaterializationV1 = {
            serverIdentityId: 'identity-a', machineId: 'machine-a', materializationId: 'installation-a',
            pluginId, version: manifest.version, sourceClass: 'versionedArchive', portableRelease: true,
            archiveDigestSha256: release.archiveDigestSha256, uiArtifacts: [], enabled: true, trustState: 'trusted', observedAt: 1,
        };
        const projection = PluginProjectionV2Schema.parse({
            v: 2, generation: 7, familiesById: {}, installedPackagesById: { [pluginId]: {
                id: pluginId, version: manifest.version, displayName: manifest.displayName, enabled: true,
                source: { kind: 'archive', locator: 'package.tgz' }, immutableGenerationId: 'generation-a',
                brand: { state: 'available', resource: { pluginId, localId: 'brand' }, width: 128, height: 128, digest: resource.digestSha256 },
            } },
        });
        const response = PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
            availabilityCursor: 1, hostingCapability: { enabled: true, maxArtifactBytes: 1024 * 1024, maxAccountBytes: 2 * 1024 * 1024 },
            intent: { pluginId, desiredVersion: manifest.version, enabled: true, offlineUiHosting: 'disabled', writableCollections: [], revision: 'intent-1' },
            release, uiArtifacts: [], packageAssets: [],
        });
        const store = createPluginAccountAvailabilityReaderStore();
        const snapshot = {
            availabilityCursor: 1, intentReads: [{ pluginId, response }], materializations: [materialization],
            snapshots: [{ serverIdentityId: 'identity-a', machineId: 'machine-a', materializations: [materialization] }],
        };
        store.replace({ scope, snapshot });
        const stored: { current: PluginAvailabilityPackageAssetReadActionOutputV1 | null } = { current: null };
        const request = vi.fn(async (path: string, init?: RequestInit) => {
            if (path === PluginAvailabilityActionHttpPathsV1['account.plugins.availability.packageAsset.publish']) {
                const payload = PluginAvailabilityPackageAssetPublishActionInputV1Schema.parse(JSON.parse(String(init?.body)));
                stored.current = PluginAvailabilityPackageAssetReadActionOutputV1Schema.parse({
                    link: { release: payload.release, artifactId: payload.artifactId, descriptor: archive.descriptor },
                    artifact: { ...payload.artifact, headerVersion: 1, bodyVersion: 1, seq: 0 },
                });
                return Response.json({ outcome: 'created', link: stored.current.link });
            }
            if (path === PluginAvailabilityActionHttpPathsV1['account.plugins.availability.packageAsset.read'] && stored.current) {
                return Response.json(stored.current);
            }
            return new Response(null, { status: 404 });
        });
        const secret = new Uint8Array(32).fill(7);
        const credentials = { token: 'fixture-account-token', secret: encodeBase64(secret, 'base64url') };
        const contentKeyFingerprint = mode === 'e2ee'
            ? convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(createAccountScopedCryptoMaterialSnapshotV1({
                accountEncryptionMode: 'e2ee', material: { type: 'legacy', secret },
            }).contentPublicKeyFingerprint)
            : null;
        const { publisher } = createPublisher({
            lifetime: active.lifetime, request, currentness: { mode, contentKeyFingerprint },
            ...(mode === 'e2ee' ? { credentials } : {}),
        });
        const resourceRead = vi.fn<PluginSurfaceResourceReadTransport>(async () => ({
            supported: true,
            result: { ok: true, resource: { pluginId, localId: 'brand' }, kind: 'asset',
                contentType: 'image/png', digest: resource.digestSha256, bytesBase64: encodeBase64(bytes, 'base64') },
        }));
        const acquisition = {
            pluginId, reader: store.bind(scope), accountLifetime: active.lifetime, projection,
            daemon: { serverId: scope.serverId, serverIdentityId: 'identity-a', machineId: 'machine-a' }, isCurrent: () => true,
        };
        await acquireAndPublishPluginAccountPackageAssets(acquisition, { publisher, resourceRead });
        expect(resourceRead).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();

        // This is the authoritative projection after the existing present-user consent CAS.
        const optedIn = PluginAccountAvailabilityIntentReadResponseV1Schema.parse({
            ...response, intent: { ...response.intent, offlineUiHosting: 'enabled', revision: 'intent-2' },
        });
        store.replace({ scope, snapshot: { ...snapshot, intentReads: [{ pluginId, response: optedIn }] } });
        await acquireAndPublishPluginAccountPackageAssets(acquisition, { publisher, resourceRead });
        expect(resourceRead).toHaveBeenCalledTimes(1);
        expect(stored.current).not.toBeNull();
        if (!stored.current) throw new Error('Expected protected Account publication.');
        const published = stored.current;

        active.retire();
        resourceRead.mockRejectedValue(new Error('Every daemon is offline.'));
        const fresh = createLifetime(scope);
        const freshReader = createPluginAccountAvailabilityReader({ scope, snapshot: {
            availabilityCursor: 1, materializations: [], snapshots: [],
            intentReads: [{ pluginId, response: { ...optedIn, packageAssets: [published.link] } }],
        } });
        const encryption = mode === 'e2ee' ? await createEncryptionFromAuthCredentials(credentials) : null;
        const source = createActivePluginAccountPackageAssetSource({
            captureLifetime: () => fresh.lifetime,
            getServerSnapshot: () => ({ serverId: scope.serverId, serverUrl: 'https://server.example', generation: 8 }),
            captureRequestAuthority: async () => ({ request,
                ...(encryption ? { decryptDataEncryptionKey: (value: string) => encryption.decryptEncryptionKey(value) } : {}),
            }),
            readAccountCurrentness: async () => ({ mode, version: 1, signingKeyFingerprint: null, updatedAt: 0, contentKeyFingerprint }),
            resolveStoredContentCompatibility: () => ({ status: 'available',
                declaration: CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION, headers: new Headers(),
            }),
        });
        await expect(readInstalledPluginBrandPresentation({
            installedPackage: projection.installedPackagesById[pluginId], machineId: null, serverId: scope.serverId,
            signal: new AbortController().signal, accountLifetime: fresh.lifetime,
            isCurrent: () => true, packageAssets: { reader: freshReader, source },
        })).resolves.toEqual({ displayName: manifest.displayName, bytes });
        expect(resourceRead).toHaveBeenCalledTimes(1);
        expect(request.mock.calls.map(([path]) => path)).toEqual([
            PluginAvailabilityActionHttpPathsV1['account.plugins.availability.packageAsset.publish'],
            PluginAvailabilityActionHttpPathsV1['account.plugins.availability.packageAsset.read'],
        ]);
    });
});
