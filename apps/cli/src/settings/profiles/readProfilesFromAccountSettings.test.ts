import { describe, expect, it } from 'vitest';

import { readProfilesFromAccountSettings } from './readProfilesFromAccountSettings';

describe('readProfilesFromAccountSettings', () => {
  it('uses current authoring memory for visibility instead of a retired settings value', () => {
    expect(readProfilesFromAccountSettings({ lastUsedProfile: 'gemini-api-key' }, undefined, { lastUsedProfile: null }).visibleProfiles).toEqual([]);
    expect(readProfilesFromAccountSettings({}, undefined, { lastUsedProfile: 'gemini-api-key' }).visibleProfiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gemini-api-key' })]),
    );
  });
  it('keeps published profiles executable and their Saved Secret references available after the Settings move', () => {
    const artifact = { artifactId: 'published', header: { kind: 'launch-profile.v1', profileId: 'shared', name: 'Shared' },
      body: JSON.stringify({ kind: 'launch-profile.v1', profile: { v: 2, id: 'shared', name: 'Shared', createdAt: 1, updatedAt: 1 },
        secretBindings: { TOKEN: 'happier:shared-secret:v1:deploy' } }) };
    const snapshot = readProfilesFromAccountSettings({ profiles: [{ artifactId: 'published' }] }, new Map([['published', artifact]]));
    expect(snapshot.visibleProfiles).toMatchObject([{ id: 'shared', artifactId: 'published' }]);
    expect(snapshot.secretBindingsByProfileId).toEqual({ shared: { TOKEN: 'happier:shared-secret:v1:deploy' } });
    expect(snapshot.opaqueProfiles).toEqual([]);
  });
  it('does not advertise legacy provider-like built-ins on a fresh account', () => {
    expect(readProfilesFromAccountSettings({}).visibleProfiles).toEqual([]);
  });

  it('returns usable legacy/slim profiles while preserving opaque rows and bindings', () => {
    const slim = {
      v: 2, id: 'slim', name: 'Slim', extraEnvironmentVariables: [{ name: 'TEAM_FLAG', value: '1' }],
      defaultPermissionModeByTargetKey: {}, defaultPersistenceModeByTargetKey: {}, compatibilityByTargetKey: { 'agent:claude': true },
      createdAt: 1, updatedAt: 1,
    };
    const opaque = { v: 99, id: 'future', keep: true };
    const result = readProfilesFromAccountSettings({
      profiles: [slim, opaque],
      secretBindingsByProfileId: { future: { TOKEN: 'secret-id' } },
    });
    // The catalog rewrites a legacy `agent:<id>` compatibility key to its
    // canonical V2 spelling on parse, so the projected profile is not
    // byte-identical to the stored row.
    expect(result.profiles).toEqual([{
      ...slim,
      compatibilityByTargetKey: { 'agent:happier.agent.claude/claude': true },
    }]);
    expect(result.opaqueProfiles).toEqual([opaque]);
    expect(result.secretBindingsByProfileId).toEqual({ future: { TOKEN: 'secret-id' } });
    expect(result.diagnostics).toHaveLength(1);
  });

  it('never canonicalizes malformed SavedSecret ids while projecting legacy bindings', () => {
    const inherited = Object.create({ TOKEN: 'inherited-secret' });
    const result = readProfilesFromAccountSettings({
      secretBindingsByProfileId: {
        padded: { TOKEN: ' real-secret ' },
        control: { TOKEN: 'bad\u0000secret' },
        oversized: { TOKEN: 'x'.repeat(257) },
        inherited,
        valid: { TOKEN: 'real-secret' },
      },
    });
    expect(result.secretBindingsByProfileId).toEqual({ valid: { TOKEN: 'real-secret' } });
  });

  it('projects the deployed Gemini no-model-pin baseline only when historical account evidence exists', () => {
    const result = readProfilesFromAccountSettings({
      lastUsedProfile: 'gemini-api-key',
      secretBindingsByProfileId: { 'gemini-api-key': { GEMINI_API_KEY: 'secret-id' } },
    });
    const profile = result.profiles.find((entry) => entry.id === 'gemini-api-key');
    expect(profile && !('v' in profile)).toBe(true);
    expect(profile && !('v' in profile) ? profile.environmentVariables : [])
      .not.toContainEqual(expect.objectContaining({ name: 'GEMINI_MODEL' }));

    expect(readProfilesFromAccountSettings({}).profiles).toEqual([]);
  });

  it('does not let a persisted historical Gemini row restore the obsolete model pin', () => {
    const result = readProfilesFromAccountSettings({
      profiles: [{
        id: 'gemini-api-key',
        name: 'Gemini (API key)',
        environmentVariables: [
          { name: 'GEMINI_MODEL', value: 'gemini-2.5-pro' },
          { name: 'TEAM_FLAG', value: '1' },
        ],
        createdAt: 1,
        updatedAt: 1,
      }],
      lastUsedProfile: 'gemini-api-key',
    });

    const visible = result.visibleProfiles.find((profile) => profile.id === 'gemini-api-key');
    expect(visible && !('v' in visible) ? visible.environmentVariables : [])
      .toEqual([{ name: 'TEAM_FLAG', value: '1' }]);
  });

  it('projects one migration-aware post-demotion catalog for list, resolver, and actions', () => {
    const result = readProfilesFromAccountSettings({
      lastUsedProfile: 'azure-openai',
      profiles: [{
        v: 2, id: 'focused', name: 'Focused', extraEnvironmentVariables: [],
        defaultPermissionModeByTargetKey: {}, defaultPersistenceModeByTargetKey: {}, compatibilityByTargetKey: {},
        createdAt: 1, updatedAt: 1,
      }],
      providerSettingsV1: {
        v: 1,
        connections: [], connectionTombstones: [], accountGrants: [], machineGrants: [],
        secretBindingsByConnectionId: {}, manualModelsByConnectionId: {}, modelVisibilityByRef: {},
        experimentalBindingConfirmations: [], defaultsByAgentTargetKey: {},
        migration: {
          v: 1,
          completedSources: [
            { sourceProfileId: 'deepseek', kind: 'connection', connectionId: 'pc_deepseek' },
            { sourceProfileId: 'codex', kind: 'default_environment' },
          ],
          pendingCustomProfileIds: [], migratedAt: 2,
        },
      },
    }, undefined, { lastUsedProfile: 'azure-openai' });

    expect(result.visibleProfiles.map((profile) => profile.id)).not.toEqual(expect.arrayContaining([
      'anthropic', 'codex', 'gemini', 'deepseek', 'gemini-api-key', 'gemini-vertex',
    ]));
    expect(result.visibleProfiles.map((profile) => profile.id)).toEqual(expect.arrayContaining(['azure-openai', 'focused']));
    expect(result.terminalMigratedProfileIds.has('deepseek')).toBe(true);
  });
});
