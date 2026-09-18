import { expect, it } from 'vitest';
import { classifyPluginAccountHostedArtifactStatus } from './pluginAccountHostedArtifactStatus';

it('distinguishes package hosting intent, retained bytes, unsupported hosting, and incomplete mixed archives', () => {
    const input = {
        hostingCapability: { enabled: true },
        intent: { pluginId: 'example.brand', desiredVersion: '1.0.0', offlineUiHosting: 'enabled' as const },
        release: { ref: { pluginId: 'example.brand', version: '1.0.0' }, uiSlots: [], packageAssetArchive: { resources: [{}] } },
        uiArtifacts: [], packageAssets: [],
    };
    expect(classifyPluginAccountHostedArtifactStatus(input)).toBe('publicationPending');
    const hosted = { ...input, packageAssets: [{}] };
    expect(classifyPluginAccountHostedArtifactStatus(hosted)).toBe('hosted');
    expect(classifyPluginAccountHostedArtifactStatus({ ...hosted, intent: { ...input.intent, offlineUiHosting: 'disabled' } })).toBe('disabledHosted');
    expect(classifyPluginAccountHostedArtifactStatus({ ...hosted, hostingCapability: { enabled: false } })).toBe('unsupportedHosted');
    expect(classifyPluginAccountHostedArtifactStatus({ ...hosted, release: { ...input.release, uiSlots: [{}] } })).toBe('publicationPending');
    expect(classifyPluginAccountHostedArtifactStatus({ ...input, release: { ...input.release, packageAssetArchive: { resources: [] } } })).toBe('unavailable');
});
