import { storage } from '@/sync/domains/state/storage';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export function resolveRepoScmMachinePathRequest(input: Readonly<{
    serverId?: string | null;
    machineId: string;
    path: string;
    homeDir?: string | null;
}>): Readonly<{
    machineId: string;
    resolvedPath: string;
    repoIdentityPrefix: string;
    repoIdentityKey: string;
}> | null {
    const hasSelectedServer = Object.prototype.hasOwnProperty.call(input, 'serverId')
        && input.serverId !== undefined;
    const serverId = typeof input.serverId === 'string' ? input.serverId.trim() : '';
    const machineId = input.machineId.trim();
    const rawPath = input.path.trim();
    if (!machineId || !rawPath || (hasSelectedServer && !serverId)) {
        return null;
    }

    const homeDir = Object.prototype.hasOwnProperty.call(input, 'homeDir')
        ? input.homeDir ?? undefined
        : storage.getState().machines?.[machineId]?.metadata?.homeDir;
    const resolvedPath = resolveAbsolutePath(rawPath, homeDir);
    const repoIdentityPrefix = serverId
        ? `server:${JSON.stringify(serverId)}:machine:${JSON.stringify(machineId)}`
        : machineId;
    return {
        machineId,
        resolvedPath,
        repoIdentityPrefix,
        repoIdentityKey: `${repoIdentityPrefix}:${resolvedPath}`,
    };
}
