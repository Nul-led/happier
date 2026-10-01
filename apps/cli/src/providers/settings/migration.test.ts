import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { vi } from 'vitest';

import type { Credentials } from '@/persistence';
import {
  createLegacyProfileMigrationSourceFingerprintV1,
  migrateProviderAccountSettingsV1,
  type AccountSettingsStoredContentEnvelope,
  type AccountSettingsV2UpdateResponse,
  type ProviderAccountSettingsMigrationContextV1,
  ProviderConnectionIdSchema,
} from '@happier-dev/protocol';

import {
  confirmLegacyProfileMigration,
  migrateProviderSettings,
  previewLegacyProfileMigration,
} from './migration';

function migrationParams(connectionId: string) {
  return {
    deriveContext: () => context(connectionId),
    acquireRegistryLease: async () => ({ registry: { generation: 'test' }, release: async () => undefined }),
  } as const;
}

function credentials(): Credentials {
  return {
    token: 'token',
    encryption: { type: 'legacy', secret: new Uint8Array(32).fill(7) },
  };
}

async function resolvePlainAccountEncryptionMode(): Promise<'plain'> {
  return 'plain';
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function context(connectionId: string): ProviderAccountSettingsMigrationContextV1 {
  return {
    migratedAt: 20,
    pendingCustomProfileIds: [],
    candidates: [{
      kind: 'connection',
      sourceProfileId: 'deepseek',
      connection: {
        v: 1,
        id: ProviderConnectionIdSchema.parse(connectionId),
        source: { kind: 'contribution', contributionKey: 'happier.deepseek/deepseek' },
        role: 'default',
        displayName: 'DeepSeek',
        displayNameMode: 'automatic',
        deployment: { kind: 'external' },
        revision: 0,
        createdAt: 20,
        updatedAt: 20,
      },
    }],
  };
}

function guidedReviewedMapping() {
  return {
    connection: {
      v: 1 as const, id: ProviderConnectionIdSchema.parse('pc-company'),
      source: { kind: 'custom' as const, template: {
        v: 1 as const, name: 'Company', endpointTemplates: [{
          id: 'chat', protocol: 'openai-chat' as const, baseUrl: 'https://company.example/v1',
          capabilities: { streaming: 'unknown' as const, toolRoundTrips: 'unknown' as const, statefulResponses: 'unknown' as const, reasoningControls: 'unknown' as const },
        }], catalog: { source: 'manual' as const, manualModelPolicy: 'allowed' as const },
      } },
      role: 'named' as const, displayName: 'Company', displayNameMode: 'custom' as const,
      deployment: { kind: 'external' as const },
      revision: 0, createdAt: 1, updatedAt: 1,
    },
    credentialMoves: [], routingEnvironmentVariableNames: ['OPENAI_BASE_URL'], manualModelIds: [],
  };
}

function guidedRawProfile() {
  return {
    profiles: [{ id: 'company', name: 'Company', environmentVariables: [{ name: 'OPENAI_BASE_URL', value: 'https://company.example/v1' }], createdAt: 1, updatedAt: 1 }],
    lastUsedProfile: 'company',
  };
}

describe('migrateProviderSettings', () => {
  beforeEach(() => {
    // Only the Account HTTP boundary is replaced; Settings CAS and all
    // authoring-memory parsing/import logic beneath it remain real.
    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (String(url).endsWith('/v1/account/encryption')) return { status: 200, data: { mode: 'plain', updatedAt: 1 } };
      if (String(url).endsWith('/v2/account/settings')) return { status: 200, data: { content: null, version: 1 } };
      return { status: 200, data: { status: 'present', revision: 1, content: { t: 'plain', v: null } } };
    });
  });
  afterEach(() => vi.restoreAllMocks());
  it.each([false, true])('clears only the removed Profile after Settings CAS, repairs interrupted clear (%s), and preserves a newer selection', async (interruptClear) => {
    let selected = 'deepseek';
    let revision = 1;
    let raw: Record<string, unknown> = {
      profiles: [{ id: 'deepseek', name: 'DeepSeek', environmentVariables: [], createdAt: 1, updatedAt: 1 }],
    };
    let version = 1;
    const events: string[] = [];
    let interruptNextClear = interruptClear;
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (String(url).endsWith('/v1/account/encryption')) return { status: 200, data: { mode: 'plain', updatedAt: 1 } };
      if (String(url).endsWith('/v2/account/settings')) return { status: 200, data: { content: { t: 'plain', v: raw }, version } };
      return { status: 200, data: { status: 'present', revision, content: { t: 'plain', v: selected } } };
    });
    const post = vi.spyOn(axios, 'post').mockImplementation(async (url, input) => {
      const body = input as { expectedVersion?: number; expectedRevision?: number; content: { t: 'plain'; v: unknown } };
      if (String(url).endsWith('/v2/account/settings')) {
        events.push('settings');
        raw = body.content.v as Record<string, unknown>;
        version += 1;
        return { status: 200, data: { success: true, version } };
      }
      events.push('memory');
      if (interruptNextClear) {
        interruptNextClear = false;
        throw new Error('Interrupted after Settings committed');
      }
      expect(body.expectedRevision).toBe(revision);
      selected = body.content.v as string;
      revision += 1;
      return { status: 200, data: { status: 'updated', revision, cursor: revision } };
    });
    try {
      if (interruptClear) {
        await expect(migrateProviderSettings({ credentials: credentials(), ...migrationParams('pc-deepseek') }))
          .rejects.toThrow('Interrupted after Settings committed');
        expect(selected).toBe('deepseek');
        expect(raw).not.toHaveProperty('lastUsedProfile');
      }
      await migrateProviderSettings({ credentials: credentials(), ...migrationParams('pc-deepseek') });
      expect(events).toEqual(interruptClear ? ['settings', 'memory', 'memory'] : ['settings', 'memory']);
      expect(selected).toBeNull();
      expect(raw).not.toHaveProperty('lastUsedProfile');
      selected = 'newer-profile';
      await migrateProviderSettings({ credentials: credentials(), ...migrationParams('pc-deepseek') });
      expect(selected).toBe('newer-profile');
    } finally { get.mockRestore(); post.mockRestore(); }
  });

  it('previews a guided mapping from the latest raw account state without writing or returning settings', async () => {
    const reviewedMapping = guidedReviewedMapping();
    const raw = guidedRawProfile();
    let updateCalls = 0;
    const result = await previewLegacyProfileMigration({
      credentials: credentials(), sourceProfileId: 'company', reviewedMapping,
      deps: {
        fetchSettings: async () => ({ content: { t: 'plain', v: raw }, version: 7 }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (): Promise<AccountSettingsV2UpdateResponse> => {
          updateCalls += 1;
          return { success: true, version: 8 };
        },
        resolveCachePath: () => '/unused/provider-settings-cache', writeCache: async () => undefined,
      },
    });
    expect(result).toEqual({
      version: 7,
      sourceFingerprint: createLegacyProfileMigrationSourceFingerprintV1({ authoringMemory: { lastUsedProfile: null },
        rawSettings: raw, sourceProfileId: 'company', reviewedMapping,
      }),
    });
    expect(updateCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain('OPENAI_BASE_URL');
  });

  it('returns a typed terminal conflict after one CAS without re-running the migration against the CAS winner', async () => {
    const rawWinner = migrateProviderAccountSettingsV1(
      { schemaVersion: 7, unrelated: 'winner' },
      context('pc_winner'),
    );
    expect(rawWinner.ok).toBe(true);
    if (!rawWinner.ok) throw new Error('expected winner fixture');

    const updateCalls: Array<{ expectedVersion: number; content: AccountSettingsStoredContentEnvelope | null }> = [];
    await expect(migrateProviderSettings({
      credentials: credentials(),
      ...migrationParams('pc_loser_preallocated_once'),
      deps: {
        fetchSettings: async () => ({
          content: { t: 'plain', v: { schemaVersion: 7, unrelated: 'initial' } },
          version: 1,
        }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (request): Promise<AccountSettingsV2UpdateResponse> => {
          updateCalls.push(request);
          return {
            success: false,
            error: 'version-mismatch',
            currentVersion: 2,
            currentContent: { t: 'plain', v: rawWinner.settings },
          };
        },
        resolveCachePath: () => '/unused/provider-settings-cache',
        writeCache: async () => undefined,
      },
    })).rejects.toThrow('Account Settings mutation did not settle: conflict');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.expectedVersion).toBe(1);
    const submitted = updateCalls[0];
    const submittedRoot = submitted?.content?.t === 'plain' ? record(submitted.content.v) : null;
    expect(submittedRoot).toMatchObject({ schemaVersion: 7, unrelated: 'initial' });
    expect(record(submittedRoot?.providerSettingsV1)).toMatchObject({
      connections: [{ id: 'pc_loser_preallocated_once' }],
    });
  });

  it('refuses a changed guided source at its single evaluation without submitting a CAS', async () => {
    const reviewedMapping = guidedReviewedMapping();
    const displayedRaw = guidedRawProfile();
    const fingerprint = createLegacyProfileMigrationSourceFingerprintV1({ authoringMemory: { lastUsedProfile: 'company' },
      rawSettings: displayedRaw, sourceProfileId: 'company', reviewedMapping,
    });
    let updates = 0;
    await expect(confirmLegacyProfileMigration({
      credentials: credentials(), sourceProfileId: 'company', expectedSourceFingerprint: fingerprint,
      reviewedMapping, migratedAt: 20,
      deps: {
        fetchSettings: async () => ({
          content: { t: 'plain', v: { ...displayedRaw, lastUsedProfile: null } },
          version: 1,
        }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (): Promise<AccountSettingsV2UpdateResponse> => {
          updates += 1;
          return { success: true, version: 2 };
        },
        resolveCachePath: () => '/unused/provider-settings-cache', writeCache: async () => undefined,
      },
    })).rejects.toMatchObject({ name: 'ProviderSettingsMigrationError', reason: 'legacy_profile_source_changed' });
    expect(updates).toBe(0);
  });

  it('reports a concurrent guided-confirmation source change as a typed conflict without post-conflict callback replay', async () => {
    const reviewedMapping = guidedReviewedMapping();
    const raw = guidedRawProfile();
    const fingerprint = createLegacyProfileMigrationSourceFingerprintV1({ authoringMemory: { lastUsedProfile: null },
      rawSettings: raw, sourceProfileId: 'company', reviewedMapping,
    });
    const updates: Array<{ expectedVersion: number }> = [];
    await expect(confirmLegacyProfileMigration({
      credentials: credentials(), sourceProfileId: 'company', expectedSourceFingerprint: fingerprint,
      reviewedMapping, migratedAt: 20,
      deps: {
        fetchSettings: async () => ({ content: { t: 'plain', v: raw }, version: 1 }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (request): Promise<AccountSettingsV2UpdateResponse> => {
          updates.push({ expectedVersion: request.expectedVersion });
          return {
            success: false, error: 'version-mismatch', currentVersion: 2,
            currentContent: { t: 'plain', v: { ...raw, lastUsedProfile: null } },
          };
        },
        resolveCachePath: () => '/unused/provider-settings-cache', writeCache: async () => undefined,
      },
    })).rejects.toThrow('Account Settings mutation did not settle: conflict');
    expect(updates).toEqual([{ expectedVersion: 1 }]);
  });

  it('lets one concurrent migrator win and returns conflict without replaying the other callback', async () => {
    let version = 1;
    let content: AccountSettingsStoredContentEnvelope = {
      t: 'plain',
      v: { schemaVersion: 7, unrelated: 'keep' },
    };
    let arrivals = 0;
    let casWins = 0;
    let observedConflicts = 0;
    const attemptedConnectionIds: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const deps = {
      fetchSettings: async () => ({ content, version }),
      resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
      updateSettings: async (request: Readonly<{
        expectedVersion: number;
        content: AccountSettingsStoredContentEnvelope | null;
      }>): Promise<AccountSettingsV2UpdateResponse> => {
        arrivals += 1;
        const attemptedRoot = request.content?.t === 'plain' ? record(request.content.v) : null;
        const attemptedSettings = record(attemptedRoot?.providerSettingsV1);
        const attemptedConnections = Array.isArray(attemptedSettings?.connections) ? attemptedSettings.connections : [];
        const attemptedId = record(attemptedConnections[0])?.id;
        attemptedConnectionIds.push(typeof attemptedId === 'string' ? attemptedId : 'missing');
        if (arrivals === 2) release();
        await barrier;
        if (request.expectedVersion !== version) {
          observedConflicts += 1;
          return { success: false, error: 'version-mismatch', currentVersion: version, currentContent: content };
        }
        casWins += 1;
        version += 1;
        content = request.content ?? { t: 'plain', v: {} };
        return { success: true, version };
      },
      resolveCachePath: () => '/unused/provider-settings-cache',
      writeCache: async () => undefined,
    } as const;

    const [left, right] = await Promise.allSettled([
      migrateProviderSettings({ credentials: credentials(), ...migrationParams('pc_left'), deps }),
      migrateProviderSettings({ credentials: credentials(), ...migrationParams('pc_right'), deps }),
    ]);

    const fulfilled = [left, right].find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof migrateProviderSettings>>> => result.status === 'fulfilled');
    const rejected = [left, right].find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toBeDefined();
    expect(rejected?.reason).toEqual(expect.objectContaining({ message: expect.stringContaining('conflict') }));
    const winnerId = fulfilled?.value.outcomes[0]?.kind === 'connection'
      ? fulfilled.value.outcomes[0].connectionId
      : null;
    expect(winnerId).toMatch(/^pc_(left|right)$/);
    expect(arrivals).toBe(2);
    expect(casWins).toBe(1);
    expect(observedConflicts).toBe(1);
    expect(new Set(attemptedConnectionIds)).toEqual(new Set(['pc_left', 'pc_right']));
    expect(content).toMatchObject({
      t: 'plain',
      v: {
        unrelated: 'keep',
        providerSettingsV1: { connections: [{ id: winnerId }] },
      },
    });
  });

  it('returns an unrelated-settings conflict without replaying the migration callback', async () => {
    let updateAttempt = 0;
    let finalContent: AccountSettingsStoredContentEnvelope | null = null;
    await expect(migrateProviderSettings({
      credentials: credentials(),
      ...migrationParams('pc_after_unrelated_conflict'),
      deps: {
        fetchSettings: async () => ({
          content: { t: 'plain', v: { schemaVersion: 7, unrelated: 'initial' } },
          version: 1,
        }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (request): Promise<AccountSettingsV2UpdateResponse> => {
          updateAttempt += 1;
          if (updateAttempt === 1) {
            return {
              success: false,
              error: 'version-mismatch',
              currentVersion: 2,
              currentContent: { t: 'plain', v: { schemaVersion: 7, unrelated: 'concurrent-winner' } },
            };
          }
          finalContent = request.content;
          return { success: true, version: 3 };
        },
        resolveCachePath: () => '/unused/provider-settings-cache',
        writeCache: async () => undefined,
      },
    })).rejects.toThrow('Account Settings mutation did not settle: conflict');

    expect(updateAttempt).toBe(1);
    expect(finalContent).toBeNull();
  });

  it('does not report a dynamic migration as complete when its submitted CAS outcome is unknown', async () => {
    let releaseCount = 0;
    let updateCalls = 0;

    await expect(migrateProviderSettings({
      credentials: credentials(),
      deriveContext: () => context('pc_outcome_unknown'),
      acquireRegistryLease: async () => ({
        registry: { generation: 'test' },
        release: async () => { releaseCount += 1; },
      }),
      deps: {
        fetchSettings: async () => ({
          content: { t: 'plain', v: { schemaVersion: 7, unrelated: 'initial' } },
          version: 1,
        }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (): Promise<AccountSettingsV2UpdateResponse> => {
          updateCalls += 1;
          throw new Error('connection reset after CAS submission');
        },
        resolveCachePath: () => '/unused/provider-settings-cache',
        writeCache: async () => undefined,
      },
    })).rejects.toThrow('Account Settings mutation did not settle: outcomeUnknown');

    expect(updateCalls).toBe(1);
    expect(releaseCount).toBe(1);
  });

  it('derives context once from the fetched baseline and releases the registry lease exactly once across a terminal conflict', async () => {
    const derivations: Array<Readonly<Record<string, unknown>>> = [];
    let acquired = 0;
    let released = 0;
    await expect(migrateProviderSettings({
      credentials: credentials(),
      acquireRegistryLease: async () => {
        acquired += 1;
        return {
          registry: { generation: 'accepted-generation' },
          release: async () => { released += 1; },
        };
      },
      deriveContext: (settings) => {
        derivations.push({ unrelated: settings.unrelated });
        return context(settings.unrelated === 'initial' ? 'pc_initial' : 'pc_from_winner');
      },
      deps: {
        fetchSettings: async () => ({
          content: { t: 'plain', v: { schemaVersion: 7, unrelated: 'initial' } }, version: 1,
        }),
        resolveAccountEncryptionMode: resolvePlainAccountEncryptionMode,
        updateSettings: async (): Promise<AccountSettingsV2UpdateResponse> => ({
          success: false, error: 'version-mismatch', currentVersion: 2,
          currentContent: { t: 'plain', v: { schemaVersion: 7, unrelated: 'winner' } },
        }),
        resolveCachePath: () => '/unused/provider-settings-cache',
        writeCache: async () => undefined,
      },
    })).rejects.toThrow('Account Settings mutation did not settle: conflict');

    expect(derivations).toEqual([{ unrelated: 'initial' }]);
    expect(acquired).toBe(1);
    expect(released).toBe(1);
  });
});
