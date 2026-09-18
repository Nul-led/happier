import type { RepositoryCheckpointAttributionScope } from '@/scm/checkpoints';

export type WorktreeAttributionInterval = Readonly<{
    repoRoot: string;
    intervalId: string;
}>;

export type WorktreeAttributionRegistry = Readonly<{
    begin: (input: WorktreeAttributionInterval) => WorktreeAttributionInterval;
    end: (input: WorktreeAttributionInterval) => void;
    resolveAttributionScope: (input: WorktreeAttributionInterval) => RepositoryCheckpointAttributionScope;
}>;

type ActiveAttributionInterval = {
    intervalId: string;
    rootComparisonKey: string;
    overlapObserved: boolean;
};

/**
 * The registry is process-local: it can only observe capture intervals registered with this same
 * owner. Another CLI process, daemon, editor, shell, or external agent is outside its census, so a
 * lack of observed overlap remains bounded to this Happier registry, never exclusive filesystem
 * access. The observation-limited value states only that this registry saw no peer interval.
 */
function resolveRootComparisonKey(repoRoot: string): string {
    return repoRoot.trim();
}

export function createWorktreeAttributionRegistry(): WorktreeAttributionRegistry {
    const activeByRootComparisonKey = new Map<string, Map<string, ActiveAttributionInterval>>();

    function readInterval(input: WorktreeAttributionInterval): ActiveAttributionInterval | null {
        const rootComparisonKey = resolveRootComparisonKey(input.repoRoot);
        const intervalId = input.intervalId.trim();
        if (!rootComparisonKey || !intervalId) return null;
        return activeByRootComparisonKey.get(rootComparisonKey)?.get(intervalId) ?? null;
    }

    return {
        begin(input) {
            const rootComparisonKey = resolveRootComparisonKey(input.repoRoot);
            const intervalId = input.intervalId.trim();
            if (!rootComparisonKey || !intervalId) return input;
            const active = activeByRootComparisonKey.get(rootComparisonKey) ?? new Map<string, ActiveAttributionInterval>();
            const existing = active.get(intervalId);
            let overlapObserved = existing?.overlapObserved ?? false;
            for (const peer of active.values()) {
                if (peer.intervalId === intervalId) continue;
                peer.overlapObserved = true;
                overlapObserved = true;
            }
            active.set(intervalId, { intervalId, rootComparisonKey, overlapObserved });
            activeByRootComparisonKey.set(rootComparisonKey, active);
            return { repoRoot: rootComparisonKey, intervalId };
        },
        end(input) {
            const rootComparisonKey = resolveRootComparisonKey(input.repoRoot);
            const active = activeByRootComparisonKey.get(rootComparisonKey);
            if (!active) return;
            active.delete(input.intervalId.trim());
            if (active.size === 0) {
                activeByRootComparisonKey.delete(rootComparisonKey);
            }
        },
        resolveAttributionScope(input) {
            const interval = readInterval(input);
            if (!interval) return 'unknown';
            return interval.overlapObserved
                ? 'shared_worktree'
                : 'no_happier_checkpoint_overlap_observed';
        },
    };
}

export const defaultWorktreeAttributionRegistry = createWorktreeAttributionRegistry();
