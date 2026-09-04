import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stageIrohNativeReleaseEvidence } from './stageIrohNativeReleaseEvidence.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('stageIrohNativeReleaseEvidence', () => {
  it('generates and immediately verifies evidence in the existing staged Iroh package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stage-iroh-native-evidence-'));
    roots.push(root);
    const repoRoot = join(root, 'repo');
    const payloadDir = join(root, 'payload');
    const stagedPackageRoot = join(payloadDir, 'node_modules', '@happier-dev', 'iroh-native');
    await mkdir(stagedPackageRoot, { recursive: true });
    await writeFile(join(stagedPackageRoot, 'package.json'), '{}\n', 'utf8');
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    await stageIrohNativeReleaseEvidence({
      repoRoot,
      payloadDir,
      required: true,
      runCommand: async (command, args) => {
        calls.push({ command, args });
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toContain(join(stagedPackageRoot, 'release-evidence'));
    expect(calls[0]?.args).not.toContain('--check');
    expect(calls[1]?.args.at(-1)).toBe('--check');
  });

  it('fails before invoking the generator when the staged Iroh package is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stage-iroh-native-evidence-missing-'));
    roots.push(root);
    await expect(stageIrohNativeReleaseEvidence({
      repoRoot: join(root, 'repo'),
      payloadDir: join(root, 'payload'),
      required: true,
      runCommand: async () => {
        throw new Error('must not run');
      },
    })).rejects.toThrow(/requires the staged Iroh package/u);
  });
});
