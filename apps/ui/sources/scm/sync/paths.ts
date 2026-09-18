import { normalizeFileSystemPath } from '@/sync/domains/fileSystem/normalizeFileSystemPath';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export function isSessionPathWithinRepoRoot(sessionPath: string, repoRoot: string, homeDir?: string): boolean {
    const normalizedSessionPath = normalizeFileSystemPath(resolveAbsolutePath(sessionPath, homeDir));
    const normalizedRepoRoot = normalizeFileSystemPath(resolveAbsolutePath(repoRoot, homeDir));
    if (!normalizedSessionPath || !normalizedRepoRoot) return false;
    if (normalizedSessionPath === normalizedRepoRoot) return true;
    return normalizedSessionPath.startsWith(normalizedRepoRoot.endsWith('/') ? normalizedRepoRoot : `${normalizedRepoRoot}/`);
}
