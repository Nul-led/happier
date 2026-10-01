import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { AgentCliRuntimeDescriptor } from '@happier-dev/cli-common/agents';
import { invokeAgentCliInstall } from './invokeAgentCliInstall';

test.skipIf(process.platform === 'win32')('an install without explicit vendor consent cannot execute the recipe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-consent-'));
  const marker = join(root, 'recipe-ran');
  const runtimeSpec: AgentCliRuntimeDescriptor = {
    id: 'fixture-agent', title: 'Fixture Agent', binaryName: 'fixture-agent',
    sourcePreferenceDefault: 'system-first', managedInstall: null,
    manualInstallKind: 'vendor_recipe', acceptsJavaScriptFileOverride: false,
    manualInstallRecipes: { linux: [{ cmd: '/bin/sh', args: ['-c', 'printf ran > "$1"', 'fixture', marker] }] },
  };
  try {
    const result = await invokeAgentCliInstall({
      agentId: runtimeSpec.id, runtimeSpec, nodePlatform: 'linux',
      env: { HOME: root, HAPPIER_HOME_DIR: root, PATH: join(root, 'empty-path') },
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'install-confirmation-required' });
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
