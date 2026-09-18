import type { CatalogAgentLookupId } from '@/agent/catalog/ids';
import type { StoredCredentials } from '@/persistence';
import { resolveForegroundProfileSavedSecretEnvironment } from '@/daemon/agentRuntime/resolveForegroundProfileSavedSecretEnvironment';
import {
  buildProfileEnvOverlay,
  expandProfileEnvOverlay,
} from '@/settings/profiles/buildProfileEnvOverlay';
import { readProfilesFromAccountSettings } from '@/settings/profiles/readProfilesFromAccountSettings';
import { deriveSettingsSecretsReadKeysForCredentials } from '@/settings/secrets/settingsSecretsKey';

export type ProfileProbeEnvironment = Readonly<{
  cacheKey: string;
  env: Readonly<Record<string, string>>;
}>;

export async function resolveProfileProbeEnvironment(params: Readonly<{
  agentId: CatalogAgentLookupId;
  profileId?: unknown;
  accountSettings: Readonly<Record<string, unknown>> | null;
  credentials: StoredCredentials | null;
  processEnv: NodeJS.ProcessEnv;
}>): Promise<ProfileProbeEnvironment | null> {
  const profileId = typeof params.profileId === 'string' ? params.profileId.trim() : '';
  if (!profileId) return null;
  if (!params.accountSettings || !params.credentials) {
    throw new Error('The selected profile cannot be resolved for this preflight probe');
  }

  const profileSnapshot = readProfilesFromAccountSettings(params.accountSettings);
  const profile = profileSnapshot.visibleProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Profile "${profileId}" is unavailable for this preflight probe`);
  }
  const requiredSecretRequirementNamesMissingBinding = new Set(
    profile.envVarRequirements
      ?.filter((requirement) =>
        (requirement.kind ?? 'secret') === 'secret'
        && requirement.required === true
        && !profileSnapshot.secretBindingsByProfileId[profile.id]?.[requirement.name],
      )
      .map((requirement) => requirement.name) ?? [],
  );
  const overlay = await buildProfileEnvOverlay({
    agentId: params.agentId,
    profile,
    processEnv: params.processEnv,
    promptSecretFn: null,
    reservedEnvironmentVariableNames: new Set(),
    requiredSecretRequirementNamesMissingBinding,
  });
  const savedSecretEnvironment = resolveForegroundProfileSavedSecretEnvironment({
    profile,
    accountSettings: params.accountSettings,
    settingsSecretsReadKeys: deriveSettingsSecretsReadKeysForCredentials(params.credentials),
    foregroundSatisfiedSecretRequirementNames: overlay.foregroundSatisfiedSecretRequirementNames,
  });
  const expandedOverlay = expandProfileEnvOverlay({
    profile,
    envOverlayRaw: overlay.envOverlayRaw,
    processEnv: params.processEnv,
    resolvedEnvironment: savedSecretEnvironment,
  });

  return Object.freeze({
    cacheKey: profile.id,
    env: Object.freeze({
      ...expandedOverlay,
      ...savedSecretEnvironment,
      HAPPIER_SESSION_PROFILE_ID: profile.id,
    }),
  });
}
