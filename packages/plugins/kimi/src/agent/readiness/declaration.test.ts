import { describe, expect, it } from 'vitest';

import { definePlugin } from '@happier-dev/plugin-sdk';
import { ingestPluginManifestV2 } from '@happier-dev/protocol';

import { KIMI_SYSTEM_TOOL_READINESS } from './declaration.js';

describe('Kimi system tool readiness declaration', () => {
  it('declares capability fingerprints so selection never orders by semver', () => {
    // Retired `kimi-cli` releases sort above current Kimi Code releases, and a
    // legacy install may own the `kimi` name while answering `kimi acp` without
    // the `migrate` command surface. This provider-owned data is what the
    // generic system-tool resolution owner consumes; versions are never read.
    expect(KIMI_SYSTEM_TOOL_READINESS).toMatchObject({
      acpProbeArgs: ['acp'],
      currentFingerprint: {
        loadSession: true,
        sessionCapabilities: ['list', 'resume', 'close', 'delete', 'fork'],
        mcpHttp: true,
        mcpSse: true,
      },
      legacyFingerprint: {
        loadSession: true,
        sessionCapabilities: ['list', 'resume'],
        absentSessionCapabilities: ['close', 'delete', 'fork'],
        mcpHttp: true,
        mcpSse: false,
      },
      commandSurfaceArgs: ['migrate', '--help'],
      legacyExecutableNames: ['kimi-cli'],
    });
    expect(KIMI_SYSTEM_TOOL_READINESS.legacyGuidance).toContain('kimi migrate');
    expect(KIMI_SYSTEM_TOOL_READINESS).not.toHaveProperty('minimumVersion');
  });

  it('passes the plugin authoring and manifest ingest owners unchanged', () => {
    // The full Kimi manifest also declares an Agent surface that concurrent
    // work is reshaping, so this wires the exact provider data through the
    // real `definePlugin` + ingest owners with a systemTools-only plugin.
    const plugin = definePlugin({
      id: 'test.kimi-readiness',
      version: '0.0.0',
      systemTools: {
        'kimi-cli': {
          title: 'Kimi Code CLI',
          executableNames: ['kimi'],
          readiness: KIMI_SYSTEM_TOOL_READINESS,
        },
      },
    });
    expect(plugin.manifest.contributes?.systemTools).toContainEqual(
      expect.objectContaining({ id: 'kimi-cli', executableNames: ['kimi'] }),
    );
    expect(ingestPluginManifestV2(plugin.manifest)).toMatchObject({ ok: true });
    expect(ingestPluginManifestV2(JSON.stringify(plugin.manifest))).toMatchObject({ ok: true });
  });
});
