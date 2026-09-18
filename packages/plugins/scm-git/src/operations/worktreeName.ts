import { join } from 'node:path';
import { buildWorktreeRelativePath } from '@happier-dev/plugin-sdk/scm';

export function buildWorktreeTargetPath(repoRoot: string, branchName: string): string {
    return join(repoRoot, ...buildWorktreeRelativePath(branchName).split('/'));
}
