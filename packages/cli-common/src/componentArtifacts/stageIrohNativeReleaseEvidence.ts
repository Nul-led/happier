import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { execOrThrow, type RunCommand } from './commands.js';

const IROH_PACKAGE_RELATIVE_PATH = join('node_modules', '@happier-dev', 'iroh-native');

export async function stageIrohNativeReleaseEvidence({
  repoRoot,
  payloadDir,
  required,
  runCommand = execOrThrow,
}: {
  repoRoot: string;
  payloadDir: string;
  required: boolean;
  runCommand?: RunCommand;
}): Promise<void> {
  if (!required) return;

  const stagedPackageRoot = join(payloadDir, IROH_PACKAGE_RELATIVE_PATH);
  const stagedPackage = await stat(join(stagedPackageRoot, 'package.json')).catch(() => null);
  if (!stagedPackage?.isFile()) {
    throw new Error('[component-artifacts] native Iroh release evidence requires the staged Iroh package');
  }

  const generatorPath = join(
    repoRoot,
    'packages',
    'iroh-native',
    'scripts',
    'generate-native-release-evidence.mjs',
  );
  const manifestPath = join(repoRoot, 'packages', 'iroh-native', 'rust', 'Cargo.toml');
  const outputDir = join(stagedPackageRoot, 'release-evidence');
  const args = [
    generatorPath,
    '--package-root',
    join(repoRoot, 'packages', 'iroh-native'),
    '--manifest-path',
    manifestPath,
    '--output-dir',
    outputDir,
  ];
  await runCommand(process.execPath, args, { cwd: repoRoot });
  await runCommand(process.execPath, [...args, '--check'], { cwd: repoRoot });
}
