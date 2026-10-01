import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { createWorkspacePackageSourcesPlugin } from '../../scripts/testing/vitestWorkspacePackageResolution.ts';

const workspacePackages = ['agents', 'cli-common', 'protocol', 'release-runtime'].map((name) => ({
  packageName: `@happier-dev/${name}`,
  packageSourceRoot: fileURLToPath(new URL(`../${name}/src`, import.meta.url)),
}));

export default defineConfig({
  plugins: [createWorkspacePackageSourcesPlugin(workspacePackages, 'happier-cli-common-workspace-package-sources')],
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['tests/**/*.mjs', 'dist/**', 'node_modules/**'],
  },
});
