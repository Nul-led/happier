import type { SpawnSessionOptions, SpawnSessionResult } from '@/session/shared/spawnSessionContract';
import { mergeSpawnSessionOptions } from '@/rpc/handlers/spawnSessionOptionsContract';

export async function runAutomationAgainstExistingSession(params: {
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  template: SpawnSessionOptions & { existingSessionId: string };
}): Promise<SpawnSessionResult> {
  return await params.spawnSession(
    mergeSpawnSessionOptions(
      params.template,
      {},
      // A saved automation template is not the user's present consent to lose
      // managed files. The canonical spawn owner retains its ordinary-path
      // default while managed resumes require explicit fresh-folder consent.
      { omit: ['approvedNewDirectoryCreation'] },
    ) as SpawnSessionOptions,
  );
}
