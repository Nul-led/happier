import type { Machine } from '@/sync/domains/state/storageTypes';

/**
 * Where work on a Machine starts when the author has not chosen a folder.
 *
 * The person's most recent folder on that Machine is the answer; the home
 * directory is the fallback for a Machine they have not used yet. New Session
 * and the Workflow editor both need this, and a second "just use homeDir"
 * policy made the same Machine open somewhere else depending on which page
 * selected it.
 */
export function resolveDefaultDirectoryForMachine(input: Readonly<{
    machineId: string | null | undefined;
    machines: ReadonlyArray<Machine>;
    recentPaths: ReadonlyArray<string>;
}>): string {
    const machineId = typeof input.machineId === 'string' ? input.machineId.trim() : '';
    if (!machineId) return '';
    const recent = input.recentPaths.find((path) => typeof path === 'string' && path.trim().length > 0);
    if (recent !== undefined) return recent;
    return input.machines.find((machine) => machine.id === machineId)?.metadata?.homeDir ?? '';
}
