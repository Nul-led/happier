import { mkdir, writeFile } from 'node:fs/promises';

import { beginWorkspaceTargetMaterialization } from './workspaceExportMaterialization';

const [targetPath, receiptPath] = process.argv.slice(2);
if (!targetPath || !receiptPath) throw new Error('materialization child fixture arguments are required');

const materialization = await beginWorkspaceTargetMaterialization({
    targetPath,
    backupDirectoryPrefix: '.backup',
});
await mkdir(targetPath);
await writeFile(`${targetPath}/new.txt`, 'new', 'utf8');
await writeFile(receiptPath, JSON.stringify(materialization.custody.receipt), 'utf8');
await new Promise<void>(() => { setInterval(() => undefined, 1_000); });
