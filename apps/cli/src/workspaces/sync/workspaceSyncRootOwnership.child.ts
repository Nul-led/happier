import { access, writeFile } from 'node:fs/promises';

import { createWorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

const [lockDirectory, ownerId, canonicalRoot, resultPath, releasePath] = process.argv.slice(2);
if (!lockDirectory || !ownerId || !canonicalRoot || !resultPath || !releasePath) {
  throw new Error('workspace root ownership child fixture arguments are required');
}

const manager = createWorkspaceRootOwnershipManager({ lockDirectory });
const result = await manager.tryAcquire({ ownerId, canonicalRoot, operation: 'sync' });
await writeFile(resultPath, JSON.stringify('kind' in result
  ? { kind: result.kind, existingOwnerId: result.existing.ownerId }
  : { kind: 'acquired' }), 'utf8');

if (!('kind' in result)) {
  while (!(await access(releasePath).then(() => true, () => false))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await result.release();
}
