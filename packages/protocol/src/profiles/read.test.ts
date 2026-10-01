import { describe, expect, it } from 'vitest';

import {
  isLaunchProfileV2,
  readAiLaunchProfileCollection,
  loadAiLaunchProfileArtifacts,
  shouldPreserveLegacyAiLaunchProfileBindingV1,
} from './read.js';

describe('readAiLaunchProfileCollection', () => {
  it('never downgrades a future or malformed versioned row to a legacy profile just because id and name exist', () => {
    const rows = [
      { v: 99, id: 'future', name: 'Future', payload: { retain: true } },
      { v: 2, id: 'malformed', name: 'Malformed', createdAt: -1, updatedAt: 1 },
    ];
    const result = readAiLaunchProfileCollection(rows);
    expect(result.entries.map((entry) => entry.kind)).toEqual(['opaque', 'opaque']);
    expect(result.diagnostics).toEqual([{ index: 0, reason: 'future_version' }, { index: 1, reason: 'malformed' }]);
    expect(result.entries.map((entry) => entry.raw)).toEqual(rows);
  });

  it('opens a Settings reference only from its authorized current Artifact without rewriting the raw row', () => {
    const reference = { artifactId: 'published' };
    const artifact = { artifactId: 'published', header: { kind: 'launch-profile.v1', profileId: 'shared', name: 'Shared' },
      body: JSON.stringify({ kind: 'launch-profile.v1', profile: { v: 2, id: 'shared', name: 'Shared', createdAt: 1, updatedAt: 1 },
        secretBindings: { DEPLOY_TOKEN: 'happier:shared-secret:v1:deploy' } }) };
    const opened = readAiLaunchProfileCollection([reference], { artifactsById: new Map([['published', artifact]]) });
    expect(opened.entries[0]).toMatchObject({ kind: 'slim', artifactId: 'published', profile: { id: 'shared' },
      secretBindings: { DEPLOY_TOKEN: 'happier:shared-secret:v1:deploy' }, raw: reference });
    expect(opened.entries[0]?.kind !== 'opaque' && opened.entries[0]?.profile).toMatchObject({
      artifactId: 'published', secretBindings: { DEPLOY_TOKEN: 'happier:shared-secret:v1:deploy' },
    });
    expect(opened.raw).toEqual([reference]);
    expect(readAiLaunchProfileCollection([reference]).entries[0]?.kind).toBe('opaque');
    expect(readAiLaunchProfileCollection([reference], { artifactsById: new Map() }).diagnostics)
      .toEqual([{ index: 0, reason: 'artifact_unavailable' }]);
  });

  it('hydrates referenced and current grant documents through the same Artifact reader, paging and deduplicating reads', async () => {
    const document = (artifactId: string, access: 'owner' | 'view') => ({ artifactId, access,
      header: { kind: 'launch-profile.v1', profileId: artifactId, name: artifactId },
      body: JSON.stringify({ kind: 'launch-profile.v1', profile: { v: 2, id: artifactId, name: artifactId, createdAt: 1, updatedAt: 1 } }),
      revision: { headerVersion: 1, bodyVersion: 2 } });
    const reads: string[] = [];
    const owned = document('owned', 'owner');
    const shared = document('shared', 'view');
    const resources = await loadAiLaunchProfileArtifacts([{ artifactId: 'owned' }, { artifactId: 'owned' }], {
      read: async (id) => { reads.push(id); return id === 'owned' ? owned : shared; },
      list: async (options) => options.cursor
        ? { items: [shared] }
        : { items: [owned, { artifactId: 'role', access: 'view', header: { kind: 'role.v1' } }], nextCursor: 'page-two' },
    });
    expect(reads).toEqual(['owned', 'shared']);
    const result = readAiLaunchProfileCollection([{ artifactId: 'owned' }], { artifactsById: resources, includeShared: true });
    expect(result.entries.filter((entry) => entry.kind !== 'opaque').map((entry) => entry.profile)).toMatchObject([
      { id: 'owned', artifactId: 'owned', shared: false },
      { id: 'shared', artifactId: 'shared', shared: true, viewOnly: true, revision: { headerVersion: 1, bodyVersion: 2 } },
    ]);
    expect(readAiLaunchProfileCollection([], { artifactsById: new Map(), includeShared: true }).entries).toEqual([]);
  });

  it('preserves valid legacy, slim, malformed, and future entries without rewriting them', () => {
    const entries = [
      { id: 'legacy', name: 'Legacy', environmentVariables: [], createdAt: 1, updatedAt: 1 },
      {
        v: 2, id: 'slim', name: 'Slim', extraEnvironmentVariables: [],
        defaultPermissionModeByTargetKey: {}, defaultPersistenceModeByTargetKey: {}, compatibilityByTargetKey: {},
        createdAt: 1, updatedAt: 1,
      },
      { v: 99, id: 'future', payload: { preserve: true } },
      { v: 2, id: '', malformed: true },
    ];
    const result = readAiLaunchProfileCollection(entries);
    expect(result.entries.map((entry) => entry.kind)).toEqual(['legacy', 'slim', 'opaque', 'opaque']);
    expect(result.raw).toEqual(entries);
    expect(result.diagnostics).toHaveLength(2);
  });

  it('classifies parsed launch profiles through one canonical discriminator', () => {
    const result = readAiLaunchProfileCollection([
      { id: 'legacy', name: 'Legacy', environmentVariables: [], createdAt: 1, updatedAt: 1 },
      {
        v: 2, id: 'slim', name: 'Slim', extraEnvironmentVariables: [],
        defaultPermissionModeByTargetKey: {}, defaultPersistenceModeByTargetKey: {}, compatibilityByTargetKey: {},
        createdAt: 1, updatedAt: 1,
      },
    ]);

    const legacy = result.entries[0];
    const slim = result.entries[1];
    expect(legacy?.kind).toBe('legacy');
    expect(slim?.kind).toBe('slim');
    if (legacy?.kind !== 'legacy' || slim?.kind !== 'slim') throw new Error('expected parsed profiles');
    expect(isLaunchProfileV2(legacy.profile)).toBe(false);
    expect(isLaunchProfileV2(slim.profile)).toBe(true);
  });

  it('removes the obsolete Gemini model pin from persisted historical profile rows at the shared read boundary', () => {
    const result = readAiLaunchProfileCollection([{
      id: 'gemini-api-key',
      name: 'Gemini (API key)',
      environmentVariables: [
        { name: 'GEMINI_MODEL', value: 'gemini-2.5-pro' },
        { name: 'TEAM_FLAG', value: '1' },
      ],
      createdAt: 1,
      updatedAt: 1,
    }]);

    const entry = result.entries[0];
    expect(entry?.kind).toBe('legacy');
    if (entry?.kind !== 'legacy') throw new Error('expected a legacy profile');
    expect(entry.profile.environmentVariables).toEqual([{ name: 'TEAM_FLAG', value: '1' }]);
    expect(result.raw).toEqual([expect.objectContaining({
      environmentVariables: expect.arrayContaining([{ name: 'GEMINI_MODEL', value: 'gemini-2.5-pro' }]),
    })]);
  });

  it('projects the moving predecessor legacy coding-prompt override onto the canonical V2 override shape', () => {
    // Exact persisted shape written by remote-dev's legacy ProfileEditForm.
    const result = readAiLaunchProfileCollection([{
      id: 'remote-dev-profile',
      name: 'Remote Dev Profile',
      environmentVariables: [],
      envVarRequirements: [],
      defaultPermissionModeByTargetKey: {},
      defaultPermissionModeByAgent: {},
      defaultPersistenceModeByTargetKey: {},
      defaultPersistenceModeByAgent: {},
      compatibilityByTargetKey: {},
      compatibility: {},
      isBuiltIn: false,
      defaultEnabled: true,
      createdAt: 1,
      updatedAt: 1,
      version: '1.0.0',
      codingPromptBehaviorV1: { v: 1, responseOptions: 'disabled' },
    }]);

    const entry = result.entries[0];
    expect(entry?.kind).toBe('legacy');
    if (entry?.kind !== 'legacy') throw new Error('expected a legacy profile');
    expect(entry.profile).toMatchObject({
      codingPromptBehaviorOverrides: { responseOptions: 'disabled' },
    });
    expect(entry.profile.codingPromptBehaviorV1).toEqual({ v: 1, responseOptions: 'disabled' });
  });

  it('preserves bindings for persisted, opaque, pending, and historical built-in profiles without treating completion as a UI pruning signal', () => {
    const collection = readAiLaunchProfileCollection([
      { id: 'persisted', name: 'Persisted', environmentVariables: [], createdAt: 1, updatedAt: 1 },
      { v: 99, id: 'future', payload: { preserve: true } },
    ]);
    const migration = {
      v: 1 as const,
      completedSources: [{ sourceProfileId: 'deepseek', kind: 'default_environment' as const }],
      pendingCustomProfileIds: ['pending'],
    };

    for (const profileId of ['persisted', 'future', 'pending', 'gemini', 'gemini-api-key', 'azure-openai']) {
      expect(shouldPreserveLegacyAiLaunchProfileBindingV1({ profileId, collection, migration }), profileId).toBe(true);
    }
    expect(shouldPreserveLegacyAiLaunchProfileBindingV1({ profileId: 'deepseek', collection, migration })).toBe(true);
    expect(shouldPreserveLegacyAiLaunchProfileBindingV1({ profileId: 'absent-custom', collection, migration })).toBe(false);
  });
});
