import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beginWorkspaceTargetMaterialization } from '@/scm/workspace/workspaceExportMaterialization';
import { createWorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { computeWorkspaceSyncRootFingerprint, workspaceSyncTargetBootstrap } from './workspaceSyncTargetBootstrap';

const [mode, targetPath, stagingDirectory, readyPath] = process.argv.slice(2);
if ((mode !== 'existing' && mode !== 'missing-git') || !targetPath || !stagingDirectory || !readyPath) {
  throw new Error('workspace sync bootstrap child fixture arguments are required');
}

const rootOwnershipManager = createWorkspaceRootOwnershipManager({
  lockDirectory: join(stagingDirectory, 'root-locks'),
});

await workspaceSyncTargetBootstrap({
  rootPath: targetPath,
  sourceRootPath: join(stagingDirectory, 'source'),
  relationshipId: 'relationship-crash',
  endpointRole: 'beta',
  policyDigest: 'a'.repeat(64),
  contentSelection: mode === 'missing-git' ? 'git_worktree' : 'all_files',
  ...(mode === 'existing' ? { targetReplacementApproval: {
    v: 1 as const,
    consequences: ['replace_nonempty_workspace_target'] as const,
    serverId: 'server-1',
    machineId: 'machine-b',
    canonicalRoot: targetPath,
    rootFingerprint: await computeWorkspaceSyncRootFingerprint(targetPath),
    operationId: 'relationship-crash',
  } } : {}),
  stagingDirectory,
  rootOwnershipManager,
  createIfMissing: mode === 'missing-git',
  targetBootstrap: 'materialize_from_source_workspace',
  ...(mode === 'existing'
    ? {
        materializeSeed: async ({ canonicalRoot, materializationReceiptPath, originalTargetExists }) => {
          const materialization = await beginWorkspaceTargetMaterialization({
            targetPath: canonicalRoot,
            backupDirectoryPrefix: '.happier-sync-backup',
            receiptPath: materializationReceiptPath,
            originalTargetExists,
          });
          await mkdir(canonicalRoot);
          await writeFile(join(canonicalRoot, 'new.txt'), 'new');
          await writeFile(readyPath, 'renamed');
          await new Promise<void>(() => undefined);
          return materialization.custody;
        },
      }
    : {
        prepareGitTarget: async ({ canonicalRoot, materializationReceiptPath }) => {
          await access(canonicalRoot);
          await access(materializationReceiptPath);
          await writeFile(readyPath, 'created-before-git');
          await new Promise<void>(() => undefined);
        },
      }),
});
