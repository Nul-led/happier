import type { PinnedRunnerSnapshotLocation } from '../pinnedRunnerSnapshot.mjs';

export function publishPinnedRunnerSnapshotFixture(input: Readonly<{
  stagingRoot: string;
  snapshotsDir?: string;
  workspaceRuntimeIdentity: string;
  workspaceRuntimePackages?: readonly string[];
  publicationFailuresBytes?: string;
  layoutVersion?: string;
  builtAt?: string;
  mtimeMs?: number;
}>): PinnedRunnerSnapshotLocation;
