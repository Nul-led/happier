import { describe, expect, it } from 'vitest';

import { resolveCanonicalSpawnProfile, validateSpawnProfileEnvironment } from './validateSpawnProfile';

const slim = {
  v: 2 as const,
  id: 'focused',
  name: 'Focused',
  extraEnvironmentVariables: [{ name: 'TEAM_FLAG', value: '1' }],
  defaultPermissionModeByTargetKey: {},
  defaultPersistenceModeByTargetKey: {},
  compatibilityByTargetKey: {},
  createdAt: 1,
  updatedAt: 1,
};

describe('validateSpawnProfileEnvironment', () => {
  it('resolves published and grant-visible profiles without pretending a reference is an inline row', () => {
    const profile = { ...slim, extraEnvironmentVariables: [] };
    const resource = { artifactId: 'document', header: { kind: 'launch-profile.v1', profileId: profile.id, name: profile.name },
      body: JSON.stringify({ kind: 'launch-profile.v1', profile, secretBindings: {} }), access: 'view' as const };
    const artifactsById = new Map([[resource.artifactId, resource]]);
    expect(resolveCanonicalSpawnProfile({ rawSettings: { profiles: [{ artifactId: 'document' }] }, profileId: profile.id, artifactsById }))
      .toMatchObject({ ok: true, kind: 'slim', profile: { id: profile.id, artifactId: 'document', viewOnly: true } });
    expect(resolveCanonicalSpawnProfile({ rawSettings: {}, profileId: profile.id, artifactsById }))
      .toMatchObject({ ok: true, kind: 'slim' });
    expect(resolveCanonicalSpawnProfile({ rawSettings: { profiles: [{ artifactId: 'document' }, profile] }, profileId: profile.id, artifactsById }))
      .toMatchObject({ ok: false, reason: 'profile_overlay_mismatch' });
  });

  it('rejects dynamic agent-owned keys in canonical V2 profiles and mismatched caller overlays', () => {
    expect(validateSpawnProfileEnvironment({
      rawSettings: { profiles: [{ ...slim, extraEnvironmentVariables: [{ name: 'THIRD_PARTY_AUTH', value: 'secret' }] }] },
      profileId: 'focused',
      providedEnvironmentVariables: { THIRD_PARTY_AUTH: 'secret' },
      reservedEnvironmentVariableNames: new Set(['THIRD_PARTY_AUTH']),
    })).toMatchObject({ ok: false, reason: 'reserved_environment' });

    expect(validateSpawnProfileEnvironment({
      rawSettings: { profiles: [slim] },
      profileId: 'focused',
      providedEnvironmentVariables: { TEAM_FLAG: 'caller-substituted' },
      reservedEnvironmentVariableNames: new Set(),
    })).toMatchObject({ ok: false, reason: 'profile_overlay_mismatch' });
  });

  it('accepts exact V2 overlays and preserves retained V1 compatibility', () => {
    expect(validateSpawnProfileEnvironment({
      rawSettings: { profiles: [slim] },
      profileId: 'focused',
      providedEnvironmentVariables: { TEAM_FLAG: '1', SESSION_ONLY_FLAG: 'allowed' },
      reservedEnvironmentVariableNames: new Set(['THIRD_PARTY_AUTH']),
    })).toEqual({ ok: true, kind: 'slim' });

    expect(validateSpawnProfileEnvironment({
      rawSettings: { profiles: [{
        id: 'azure-openai', name: 'Azure OpenAI',
        environmentVariables: [{ name: 'OPENAI_API_KEY', value: '${AZURE_OPENAI_API_KEY}' }],
        createdAt: 1, updatedAt: 1,
      }] },
      profileId: 'azure-openai',
      providedEnvironmentVariables: { OPENAI_API_KEY: 'legacy-compatible' },
      reservedEnvironmentVariableNames: new Set(['OPENAI_API_KEY']),
    })).toEqual({ ok: true, kind: 'legacy' });
  });

  it('allows pre-migration built-in compatibility but rejects stale terminal migration references', () => {
    expect(validateSpawnProfileEnvironment({
      rawSettings: null,
      profileId: 'deepseek',
      providedEnvironmentVariables: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
      reservedEnvironmentVariableNames: new Set(['ANTHROPIC_BASE_URL']),
    })).toMatchObject({ ok: false, reason: 'profile_overlay_mismatch' });

    expect(validateSpawnProfileEnvironment({
      rawSettings: {},
      profileId: 'deepseek',
      providedEnvironmentVariables: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
      reservedEnvironmentVariableNames: new Set(['ANTHROPIC_BASE_URL']),
    })).toEqual({ ok: true, kind: 'legacy' });

    expect(validateSpawnProfileEnvironment({
      rawSettings: {
        providerSettingsV1: {
          v: 1,
          connections: [], connectionTombstones: [], accountGrants: [], machineGrants: [],
          secretBindingsByConnectionId: {}, manualModelsByConnectionId: {}, modelVisibilityByRef: {},
          experimentalBindingConfirmations: [], defaultsByAgentTargetKey: {},
          migration: {
            v: 1,
            completedSources: [{ sourceProfileId: 'deepseek', kind: 'connection', connectionId: 'pc_deepseek' }],
            pendingCustomProfileIds: [],
            migratedAt: 2,
          },
        },
      },
      profileId: 'deepseek',
      providedEnvironmentVariables: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
      reservedEnvironmentVariableNames: new Set(['ANTHROPIC_BASE_URL']),
    })).toMatchObject({ ok: false, reason: 'profile_overlay_mismatch' });
  });
});
