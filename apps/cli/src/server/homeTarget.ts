import {
  resolveHomeTarget,
  type HomeTargetInput,
  type ResolvedHomeTarget,
  type SavedHomeTargetProfile,
} from '@happier-dev/cli-common/homeTarget';

import { configuration } from '@/configuration';
import { getServerProfile } from '@/server/serverProfiles';

async function readSavedProfile(profileRef: string): Promise<SavedHomeTargetProfile | null> {
  try {
    return await getServerProfile(profileRef);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

export async function resolveCliHomeTarget(input: HomeTargetInput): Promise<ResolvedHomeTarget> {
  return await resolveHomeTarget({ input, readSavedProfile });
}

export async function resolveCurrentCliHomeTarget(): Promise<ResolvedHomeTarget> {
  const active = await readSavedProfile(configuration.activeServerId);
  if (active) {
    return await resolveCliHomeTarget({ kind: 'saved_profile', profileRef: active.id });
  }
  return await resolveCliHomeTarget({ kind: 'https_url', url: configuration.serverUrl });
}
