import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PERSONAL_HOME_SERVER_ARTIFACT_CAPABILITY_FILE,
  assertPersonalHomeServerArtifactCapability,
  writePersonalHomeServerArtifactCapability,
} from './artifactContract';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'happier-home-artifact-'));
  roots.push(root);
  return root;
}

describe('Personal Home server artifact capability contract', () => {
  it('admits only the exact server-owned bootstrap and descriptor/Iroh capability set', async () => {
    const root = await createRoot();
    await writePersonalHomeServerArtifactCapability(root);

    await expect(assertPersonalHomeServerArtifactCapability({
      payloadRoot: root,
      provenance: { channel: 'preview', versionId: '0.3.0-preview.1', source: 'https://example.test/release.tar.gz' },
    })).resolves.toEqual({
      channel: 'preview',
      versionId: '0.3.0-preview.1',
      source: 'https://example.test/release.tar.gz',
    });
  });

  it.each([
    ['missing', null],
    ['malformed', '{'],
    ['nearby version without the exact Iroh contract', JSON.stringify({
      v: 1,
      component: 'happier-server',
      capabilities: { personalHomeBootstrap: 1, homeConnectionDescriptor: 1 },
    })],
  ])('rejects %s evidence before any installer receives the payload', async (_label, contents) => {
    const root = await createRoot();
    await mkdir(root, { recursive: true });
    if (contents !== null) {
      await writeFile(join(root, PERSONAL_HOME_SERVER_ARTIFACT_CAPABILITY_FILE), contents, 'utf8');
    }

    await expect(assertPersonalHomeServerArtifactCapability({
      payloadRoot: root,
      provenance: { channel: 'stable', versionId: '0.2.11', source: 'https://example.test/old.tar.gz' },
    })).rejects.toMatchObject({ code: 'personal_home_artifact_update_required' });
  });
});
