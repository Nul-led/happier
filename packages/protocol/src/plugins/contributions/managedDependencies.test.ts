import { describe, expect, it } from 'vitest';

import { PluginManagedDependencyContributionV2Schema } from './managedDependencies.js';

describe('PluginManagedDependencyContributionV2Schema', () => {
  it('accepts a pinned direct archive with exact platform assets and rejects unsafe integrity or executable paths', () => {
    const dependency = {
      id: 'acp-server', title: 'ACP server', executable: 'agy_acp_server',
      sources: [{ kind: 'pinnedArchive', installId: 'dep.antigravity.acp-server', version: '1.1.1', assetsByPlatform: {
        'linux-x64': {
          archiveUrl: 'https://dl.example.test/agy-acp-server.zip', sha256: 'a'.repeat(64),
          executableSubpath: 'agy_acp_server.par', args: ['--uid='],
        },
      } }],
    };
    expect(PluginManagedDependencyContributionV2Schema.safeParse(dependency).success).toBe(true);
    expect(PluginManagedDependencyContributionV2Schema.safeParse({
      ...dependency,
      sources: [{ ...dependency.sources[0], assetsByPlatform: { 'linux-x64': {
        ...dependency.sources[0]!.assetsByPlatform['linux-x64'], sha256: 'not-a-digest',
      } } }],
    }).success).toBe(false);
    expect(PluginManagedDependencyContributionV2Schema.safeParse({
      ...dependency,
      sources: [{ ...dependency.sources[0], assetsByPlatform: { 'linux-x64': {
        ...dependency.sources[0]!.assetsByPlatform['linux-x64'], executableSubpath: '../agy_acp_server.par',
      } } }],
    }).success).toBe(false);
  });

  it.each([
    { kind: 'githubRelease', repository: 'acme/tool', assetPattern: 'tool-*' },
    { kind: 'npmArtifact', package: '@acme/tool', range: '^1' },
  ])('rejects unsupported executable source kind $kind at ingress', (source) => {
    expect(PluginManagedDependencyContributionV2Schema.safeParse({
      id: 'tool',
      title: 'Tool',
      executable: 'tool',
      sources: [source],
    }).success).toBe(false);
  });
});
