import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorkspacePackageDependencies, findWorkspaceRepositoryRoot } from '../../../scripts/workspaces/bundleWorkspacePackageDependencies.mjs';
import { resolveWorkspaceBundlePublicationMode } from '../../../scripts/workspaces/workspaceBundlePublication.mjs';

const repoRoot = findWorkspaceRepositoryRoot(dirname(fileURLToPath(import.meta.url)));
await bundleWorkspacePackageDependencies({
  repoRoot,
  hostPackageDir: resolve(repoRoot, 'packages', 'embed'),
  publicationMode: resolveWorkspaceBundlePublicationMode({ argv: process.argv.slice(2), env: process.env }),
  quiet: true,
});
