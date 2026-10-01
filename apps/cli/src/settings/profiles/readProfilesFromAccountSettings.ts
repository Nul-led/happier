import {
  readAiLaunchProfileCollection,
  readProviderSettingsFromAccountSettingsV1,
  resolveVisibleBuiltInAiLaunchProfilesV1,
  projectHistoricalBuiltInAiLaunchProfileV1,
  getBuiltInBackendProfile,
  isCanonicalProviderSavedSecretIdV1,
  type AIBackendProfile,
  type AiLaunchProfile,
  type AiLaunchProfileReadDiagnostic,
  type ArtifactSharingResourceV1,
  loadAiLaunchProfileArtifacts,
} from '@happier-dev/protocol';
import { createCredentialedAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';
import type { StoredCredentials } from '@/persistence';
import { readAuthoringMemoryLastUsedProfile } from './readAuthoringMemoryLastUsedProfile';

export type CliAiLaunchProfile = AiLaunchProfile;

export type AccountSettingsProfilesSnapshot = Readonly<{
  customProfiles: AIBackendProfile[];
  profiles: CliAiLaunchProfile[];
  opaqueProfiles: unknown[];
  diagnostics: readonly AiLaunchProfileReadDiagnostic[];
  secretBindingsByProfileId: Record<string, Record<string, string>>;
  visibleProfiles: CliAiLaunchProfile[];
  terminalMigratedProfileIds: ReadonlySet<string>;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function readProfilesFromAccountSettings(settings: unknown, artifactsById?: ReadonlyMap<string, ArtifactSharingResourceV1>, authoringMemory: Readonly<{ lastUsedProfile: string | null }> = { lastUsedProfile: null }): AccountSettingsProfilesSnapshot {
  const record = isPlainRecord(settings) ? settings : {};
  const customProfiles: AIBackendProfile[] = [];
  const profiles: CliAiLaunchProfile[] = [];
  const opaqueProfiles: unknown[] = [];
  const rawProfiles = record.profiles;
  const collection = readAiLaunchProfileCollection(rawProfiles, artifactsById ? { artifactsById, includeShared: true } : undefined);
  for (const entry of collection.entries) {
    if (entry.kind === 'legacy') {
      customProfiles.push(entry.profile);
      profiles.push(entry.profile);
    } else if (entry.kind === 'slim') {
      profiles.push(entry.profile);
    } else {
      opaqueProfiles.push(entry.raw);
    }
  }

  const secretBindingsByProfileId: Record<string, Record<string, string>> = {};
  const rawBindings = record.secretBindingsByProfileId;
  if (isPlainRecord(rawBindings)) {
    for (const [profileId, maybeBindings] of Object.entries(rawBindings)) {
      if (!isPlainRecord(maybeBindings)) continue;
      const out: Record<string, string> = {};
      for (const [envVarName, rawSecretId] of Object.entries(maybeBindings)) {
        if (!isCanonicalProviderSavedSecretIdV1(rawSecretId)) continue;
        out[envVarName] = rawSecretId;
      }
      if (Object.keys(out).length > 0) {
        secretBindingsByProfileId[profileId] = out;
      }
    }
  }
  for (const profile of profiles) {
    if (profile.secretBindings) secretBindingsByProfileId[profile.id] = {
      ...profile.secretBindings, ...secretBindingsByProfileId[profile.id],
    };
  }

  const favoriteProfiles = Array.isArray(record.favoriteProfiles)
    ? record.favoriteProfiles.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const enabledById = isPlainRecord(record.profileEnabledById) ? record.profileEnabledById : {};
  for (const profileId of ['gemini-api-key', 'gemini-vertex'] as const) {
    const hasHistoricalEvidence = authoringMemory.lastUsedProfile === profileId
      || favoriteProfiles.includes(profileId)
      || enabledById[profileId] === true
      || Object.prototype.hasOwnProperty.call(secretBindingsByProfileId, profileId);
    if (!hasHistoricalEvidence || profiles.some((profile) => profile.id === profileId)) continue;
    const current = getBuiltInBackendProfile(profileId);
    if (!current) continue;
    const historical = projectHistoricalBuiltInAiLaunchProfileV1(current);
    customProfiles.push(historical);
    profiles.push(historical);
  }

  const migration = readProviderSettingsFromAccountSettingsV1(record).settings.migration;
  const terminalMigratedProfileIds = new Set(
    migration?.completedSources
      .map((outcome) => outcome.sourceProfileId) ?? [],
  );
  const visibleById = new Map<string, CliAiLaunchProfile>();
  for (const builtIn of resolveVisibleBuiltInAiLaunchProfilesV1({
    evidence: {
      lastUsedProfile: authoringMemory.lastUsedProfile,
      favoriteProfileIds: favoriteProfiles,
      profileEnabledById: Object.fromEntries(
        Object.entries(enabledById).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
      ),
      secretBindingsByProfileId,
      persistedProfileIds: profiles.map((profile) => profile.id),
    },
    ...(migration ? { migration } : {}),
  })) {
    visibleById.set(builtIn.id, builtIn);
  }
  for (const profile of profiles) visibleById.set(profile.id, profile);

  return {
    customProfiles,
    profiles,
    opaqueProfiles,
    diagnostics: collection.diagnostics,
    secretBindingsByProfileId,
    visibleProfiles: [...visibleById.values()],
    terminalMigratedProfileIds,
  };
}

export async function loadAccountLaunchProfileArtifacts(settings: unknown, credentials: StoredCredentials, signal?: AbortSignal) {
  const record = isPlainRecord(settings) ? settings : {};
  return await loadAiLaunchProfileArtifacts(record.profiles, createCredentialedAccountArtifactStore(credentials), signal);
}

export async function readAccountLaunchProfiles(settings: unknown, credentials: StoredCredentials, signal?: AbortSignal) {
  const [artifacts, lastUsedProfile] = await Promise.all([
    loadAccountLaunchProfileArtifacts(settings, credentials, signal),
    readAuthoringMemoryLastUsedProfile(credentials, signal),
  ]);
  return readProfilesFromAccountSettings(settings, artifacts, { lastUsedProfile });
}
