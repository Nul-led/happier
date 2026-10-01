import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { AgentModelConfig } from '@happier-dev/agents';

import { isDynamicModelProbeEnabled, resolveNativeCatalogBearer } from './nativeCatalogCredential';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

const observation = {
  providerLocalId: 'anthropic',
  purpose: 'model_upstream',
  connectedServiceId: 'claude-subscription',
  nativeBearer: {
    fileId: '.credentials.json',
    jsonPath: ['claudeAiOauth', 'accessToken'],
  },
} as const;

describe('native catalog credentials', () => {
  it('reads only the declared native-home credential and returns an opaque fingerprint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-native-catalog-'));
    roots.push(root);
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'native-oauth-token' },
    }));
    const catalogEntry = {
      getConnectedServiceStateSharingDescriptor: async () => ({
        providerId: 'claude',
        providerSupportStatus: 'supported' as const,
        config: { supported: true, modes: ['linked', 'copied', 'isolated'] as const, entries: [] },
        state: {
          supported: true,
          modes: ['isolated', 'shared'] as const,
          entries: [],
          sharedStatePrivacyRiskAcknowledgementRequired: true,
          symlinkUnavailableDegradePolicy: 'block_continuity' as const,
        },
        authIsolation: { mode: 'materialized_home' as const, secretEntries: ['.credentials.json'] },
        nativeHome: { environmentKey: 'CLAUDE_CONFIG_DIR', defaultRelativePath: '.claude' },
      }),
    };

    const result = await resolveNativeCatalogBearer({
      observation,
      catalogEntry,
      environment: { CLAUDE_CONFIG_DIR: join(root, '.claude') },
    });

    expect(result).toEqual({
      accessToken: 'native-oauth-token',
      credentialFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('lets either the account setting or environment kill switch disable probing', () => {
    const modelConfig = {
      dynamicProbe: 'auto',
      dynamicProbeControl: {
        accountSettingId: 'claudeDynamicModelProbeEnabled',
        environmentVariable: 'HAPPIER_CLAUDE_DYNAMIC_MODEL_PROBE_ENABLED',
      },
    } as AgentModelConfig;

    expect(isDynamicModelProbeEnabled({ modelConfig, accountSettings: null, environment: {} })).toBe(true);
    expect(isDynamicModelProbeEnabled({
      modelConfig,
      accountSettings: { claudeDynamicModelProbeEnabled: false },
      environment: {},
    })).toBe(false);
    expect(isDynamicModelProbeEnabled({
      modelConfig,
      accountSettings: { claudeDynamicModelProbeEnabled: true },
      environment: { HAPPIER_CLAUDE_DYNAMIC_MODEL_PROBE_ENABLED: '0' },
    })).toBe(false);
  });
});
