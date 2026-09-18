import { describe, expect, it } from 'vitest';
import { FeaturesResponseSchema } from '@happier-dev/protocol';

import {
  createMcpActionEnablementWithServerFeatureAvailability,
  createMcpActionSettingsProvider,
} from './createMcpActionEnablement';
import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';

function readySnapshot(features: unknown): CliServerFeaturesSnapshot {
  return {
    status: 'ready',
    provenance: 'authenticated',
    features: FeaturesResponseSchema.parse({ features, capabilities: {} }),
  };
}

function createEnablement(snapshot: CliServerFeaturesSnapshot | undefined) {
  return createMcpActionEnablementWithServerFeatureAvailability({
    actionSettingsProvider: createMcpActionSettingsProvider({ accountSettings: null }),
    surface: 'api',
    hasAuthenticatedRuntime: true,
    readServerFeaturesSnapshot: () => snapshot,
    env: {},
  });
}

describe('Lane 10 Action feature availability', () => {
  it('fails closed for false, missing, and malformed exact-Home feature bits', () => {
    expect(createEnablement(readySnapshot({
      teams: { enabled: true, credentialResources: { enabled: true } },
    }))('teams.credentials.create')).toBe(true);
    expect(createEnablement(readySnapshot({
      teams: { enabled: true, credentialResources: { enabled: false } },
    }))('teams.credentials.create')).toBe(false);
    expect(createEnablement(readySnapshot({ teams: { enabled: true } }))('secrets.shared.create')).toBe(false);

    const malformed = {
      status: 'ready',
      provenance: 'authenticated',
      features: {
        features: { teams: { enabled: true, credentialResources: { enabled: 'yes' } } },
        capabilities: {},
      },
    } as unknown as CliServerFeaturesSnapshot;
    expect(createEnablement(malformed)('secrets.shared.update')).toBe(false);
  });

  it('requires the external API child bit only for external-key Actions', () => {
    const parentOnly = readySnapshot({
      teams: { enabled: true, credentialResources: { enabled: true } },
    });
    expect(createEnablement(parentOnly)('teams.credentials.create')).toBe(true);
    expect(createEnablement(parentOnly)('teams.credentials.externalKeys.create')).toBe(false);

    const externalEnabled = readySnapshot({
      teams: {
        enabled: true,
        credentialResources: { enabled: true, externalApi: { enabled: true } },
      },
    });
    expect(createEnablement(externalEnabled)('teams.credentials.externalKeys.create')).toBe(true);
    expect(createEnablement(externalEnabled)('account.apiTokens.create')).toBe(true);
  });
});
