import { describe, expect, it } from 'vitest';

import { ACCOUNT_SETTING_DEFINITIONS, accountSettingsParse } from './accountSettings.js';
import { readLegacyRolesV1, saveRolesV1WithLegacyMigration } from './rolesV1Migration.js';
import { ACCOUNT_SETTING_MAX_COLLECTION_ENTRIES, ACCOUNT_SETTING_MAX_STRING_BYTES } from './catalog/accountSettingBounds.js';
import { RolesV1Schema } from './rolesV1.js';

// V1 vectors copied from ../0.2 packages/protocol/src/prompts/executionRunsGuidanceV1.test.ts
// at 17ba05df68d4d3d4cad1c1241b58e63805db37ed; the entry carrier is declared by
// apps/ui/sources/sync/domains/settings/registry/account/accountRuntimeSettingDefinitions.ts.
const predecessorSettings = {
  executionRunsGuidanceEntries: [{
    id: '1', description: 'Prefer Claude for UI work',
    suggestedBackendTarget: { kind: 'builtInAgent', agentId: 'claude' },
    suggestedModelId: 'claude-sonnet-4-5',
    suggestedIntent: 'review',
    exampleToolCalls: ['mcp.execution.run', 'mcp.execution.list'],
  }],
};

describe('rolesV1 Account settings', () => {
  it('owns only role overrides and rejects a second role-content store', () => {
    expect(accountSettingsParse({}).rolesV1).toEqual({ overrides: {} });
    expect(ACCOUNT_SETTING_DEFINITIONS.rolesV1.parseMutationValue({
      overrides: {}, roles: [{ name: 'Another store', instructions: 'Do work' }],
    }).success).toBe(false);
  });

  it('uses the canonical Account collection and UTF-8 bounds for override writes', () => {
    const overrides = Object.fromEntries(Array.from({ length: ACCOUNT_SETTING_MAX_COLLECTION_ENTRIES }, (_, i) => [`role-${i}`, { roleId: `role-${i}` }]));
    expect(RolesV1Schema.safeParse({ overrides }).success).toBe(true);
    expect(RolesV1Schema.safeParse({ overrides: { ...overrides, extra: { roleId: 'extra' } } }).success).toBe(false);
    expect(RolesV1Schema.safeParse({ overrides: { builder: { roleId: 'builder', instructionsOverride: 'x'.repeat(ACCOUNT_SETTING_MAX_STRING_BYTES) } } }).success).toBe(true);
    expect(RolesV1Schema.safeParse({ overrides: { builder: { roleId: 'builder', instructionsOverride: 'é'.repeat(ACCOUNT_SETTING_MAX_STRING_BYTES) } } }).success).toBe(false);
    expect(RolesV1Schema.safeParse({ overrides: { builder: { roleId: 'another-role' } } }).success).toBe(false);
  });

  it('reads predecessor V1 refs and development V2 refs through one role normalizer', () => {
    const entries = readLegacyRolesV1({
      ...predecessorSettings,
      executionRunsGuidanceMaxChars: 1,
      executionRunsGuidanceEntries: [...predecessorSettings.executionRunsGuidanceEntries, {
        id: 'v2', title: 'Scout', description: 'Look around. Report paths.', enabled: false,
        suggestedBackendTarget: { kind: 'backend', backendId: 'codex' },
      }, { id: 'no-engine', description: 'Investigate failures. Read the logs.' }],
    }, 'account-one');
    expect(entries).toHaveLength(3);
    expect(entries[0]?.role).toMatchObject({
      name: 'Prefer Claude for UI work',
      runsAs: { kind: 'background_run', intent: 'review' },
      engine: { agentTargetKey: 'agent:happier.agent.claude/claude', modelId: 'claude-sonnet-4-5' },
      enabled: true, workspaceWrites: 'allow', secondOpinion: 'off',
    });
    expect(entries[0]?.role.instructions).toContain('Suggested intent: review');
    expect(entries[0]?.role.instructions).toContain('Examples');
    expect(entries[0]?.role.instructions).toContain('mcp.execution.list');
    expect(entries[1]?.role).toMatchObject({
      name: 'Scout', enabled: false, runsAs: { kind: 'session' },
      engine: { agentTargetKey: 'agent:happier.agent.codex/codex' },
    });
    expect(entries[2]?.role).toMatchObject({ name: 'Investigate failures.', runsAs: { kind: 'session' } });
    expect(entries[2]?.role.engine).toBeUndefined();
    expect(entries[2]?.role.instructions).toContain('Choose an engine');
    expect(entries[0]?.artifactId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(readLegacyRolesV1(predecessorSettings, 'account-two')[0]?.artifactId).not.toBe(entries[0]?.artifactId);
  });

  it('disables all migrated roles when the Account legacy guidance switch is off', () => {
    expect(readLegacyRolesV1({ ...predecessorSettings, executionRunsGuidanceEnabled: false }, 'account-one')[0]?.role.enabled).toBe(false);
  });

  it('uses raw root presence as the migration cut, including empty or malformed roots', () => {
    expect(readLegacyRolesV1({ ...predecessorSettings, rolesV1: { overrides: {} } }, 'account-one')).toEqual([]);
    expect(readLegacyRolesV1({ ...predecessorSettings, rolesV1: null }, 'account-one')).toEqual([]);
    expect(readLegacyRolesV1(predecessorSettings, 'account-one')).toHaveLength(1);
  });

  it('retains Artifacts before writing even an empty root, and a retry rejoins the same ids', async () => {
    const artifacts = new Map<string, unknown>();
    let rawSettings: Record<string, unknown> = { ...predecessorSettings };
    const attemptedIds: string[] = [];
    let failSave = true;
    const save = () => saveRolesV1WithLegacyMigration({
      rawSettings, accountId: 'account-one', rolesV1: { overrides: {} },
      ensureRoleArtifact: async (entry) => {
        attemptedIds.push(entry.artifactId);
        if (!artifacts.has(entry.artifactId)) artifacts.set(entry.artifactId, entry.role);
      },
      saveSettings: async (rolesV1) => {
        expect(artifacts.size).toBe(1);
        if (failSave) throw new Error('settings transport failed');
        rawSettings = { ...rawSettings, rolesV1 };
      },
    });
    await expect(save()).rejects.toThrow('settings transport failed');
    expect(rawSettings).not.toHaveProperty('rolesV1');
    failSave = false;
    await save();
    expect(attemptedIds).toHaveLength(2);
    expect(attemptedIds[0]).toBe(attemptedIds[1]);
    expect(artifacts.size).toBe(1);
    expect(readLegacyRolesV1(rawSettings, 'account-one')).toEqual([]);
    await save();
    expect(attemptedIds).toHaveLength(2);
  });

  it('never writes the authoritative root when any Artifact retention fails', async () => {
    let saved = false;
    await expect(saveRolesV1WithLegacyMigration({
      rawSettings: predecessorSettings, accountId: 'account-one', rolesV1: { overrides: {} },
      ensureRoleArtifact: async () => { throw new Error('artifact transport failed'); },
      saveSettings: async () => { saved = true; },
    })).rejects.toThrow('artifact transport failed');
    expect(saved).toBe(false);
  });
});
