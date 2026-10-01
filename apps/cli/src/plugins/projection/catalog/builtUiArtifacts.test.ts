import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBuiltUiArtifactIds } from './builtUiArtifacts';

let pluginRoot: string;

async function writeArtifactsManifest(content: string): Promise<void> {
  const dir = join(pluginRoot, 'dist', 'happier-plugin-ui');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'ui-artifacts.json'), content, 'utf8');
}

beforeEach(async () => {
  pluginRoot = await mkdtemp(join(tmpdir(), 'happier-built-ui-artifacts-'));
});

afterEach(async () => {
  await rm(pluginRoot, { recursive: true, force: true });
});

describe('readBuiltUiArtifactIds', () => {
  it('returns the artifact ids of the built universal UI artifact manifest', async () => {
    await writeArtifactsManifest(JSON.stringify({
      version: 2,
      entries: [
        {
          artifactId: 'main-native',
          tier: 'reactNative',
          entry: 'react-native/main-native/entry.cjs.bundle',
          files: [{
            relativePath: 'react-native/main-native/entry.cjs.bundle',
            digest: `sha256:${'b'.repeat(64)}`,
            byteSize: 1,
          }],
          digest: `sha256:${'a'.repeat(64)}`,
          builtWith: { bundler: 'esbuild', version: '0.25.0' },
          executable: { exports: ['renderSurface'] },
          hostUiApiRange: '^1.0.0',
        },
      ],
    }));

    expect(await readBuiltUiArtifactIds(pluginRoot)).toEqual(['main-native']);
  });

  it('returns an empty list when no built UI artifact manifest exists', async () => {
    expect(await readBuiltUiArtifactIds(pluginRoot)).toEqual([]);
  });

  it('returns an empty list for an invalid manifest instead of throwing', async () => {
    await writeArtifactsManifest('{ not valid json');
    expect(await readBuiltUiArtifactIds(pluginRoot)).toEqual([]);
  });
});
