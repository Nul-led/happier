import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginManifestV2Schema } from '@happier-dev/protocol';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createPluginAccountAvailabilityReader } from '@/sync/domains/plugins/availability/reader';
import { PluginAccountReleaseSelectionSection } from './PluginAccountReleaseSelectionSection';

const confirm = vi.hoisted(() => vi.fn(async () => false));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock({ spies: { confirm } }).module);

afterEach(() => { standardCleanup(); confirm.mockClear(); });

it('requires a hosting disclosure decision before enabling Account storage', async () => {
    const pluginId = 'example.brand';
    const reader = createPluginAccountAvailabilityReader({
        scope: { serverId: 'server-a', accountId: 'account-a' },
        snapshot: {
            availabilityCursor: 4, materializations: [], snapshots: [],
            intentReads: [{ pluginId, response: {
                availabilityCursor: 4,
                hostingCapability: { enabled: true, maxArtifactBytes: 1024, maxAccountBytes: 2048 },
                intent: { pluginId, desiredVersion: '1.0.0', enabled: true, offlineUiHosting: 'disabled', writableCollections: [], revision: 'intent-1' },
                release: {
                    ref: { pluginId, version: '1.0.0' }, archiveDigestSha256: `sha256:${'a'.repeat(64)}`,
                    normalizedManifest: PluginManifestV2Schema.parse({ schemaVersion: 2, id: pluginId, version: '1.0.0', displayName: 'Brand', engines: { happier: '^1.0.0' }, runtime: { apiVersion: 1 }, contributes: { resources: [{ id: 'brand', kind: 'asset', path: 'assets/brand.png', contentType: 'image/png' }] } }),
                    collectionContracts: [],
                    uiSlots: [],
                    packageAssetArchive: { archiveDigestSha256: `sha256:${'c'.repeat(64)}`, resources: [{ resourceId: 'brand', path: 'assets/brand.png', mimeType: 'image/png', byteSize: 3, digestSha256: `sha256:${'d'.repeat(64)}` }] },
                }, uiArtifacts: [], packageAssets: [],
            } }],
        },
    });
    const screen = await renderScreen(<PluginAccountReleaseSelectionSection
        pluginId={pluginId} version={null} reader={reader} projection={null}
        daemon={{ serverId: null, serverIdentityId: null, machineId: null }} testID="release"
    />);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.findByTestId('release.hosting')).not.toBeNull();
    await act(async () => { screen.findByTestId('release.hosting')?.props.onPress(); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(reader.readCurrentReleaseSelection({ pluginId })).toMatchObject({ kind: 'available', intent: { offlineUiHosting: 'disabled' } });
    expect(screen.findByTestId('release.clearCache')).toBeNull();
});
