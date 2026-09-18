/**
 * Checkpoint attribution scope as the current canonical vocabulary spells it. The checkpoint
 * registry is process-local: it observes only capture intervals registered with that same owner, so
 * it can report that another Happier interval overlapped, never that nothing else could write.
 */
export type CheckpointAttributionScope =
  | 'no_happier_checkpoint_overlap_observed'
  | 'shared_worktree'
  | 'unknown';

/**
 * Single classifier for checkpoint scope values. Absent evidence normalizes to `unknown`, so no
 * consumer infers an exclusivity claim this system cannot establish.
 */
export function normalizeCheckpointAttributionScope(
  scope: CheckpointAttributionScope | undefined,
): CheckpointAttributionScope {
  if (scope === 'shared_worktree') return 'shared_worktree';
  if (scope === 'no_happier_checkpoint_overlap_observed') return 'no_happier_checkpoint_overlap_observed';
  return 'unknown';
}
