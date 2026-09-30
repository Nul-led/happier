import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { parse } from 'smol-toml';
import { expect, it } from 'vitest';

import { readConnectedServiceStateSharingManifest } from '../stateSharing/connectedServiceStateSharingManifest';
import { materializeConnectedServicesForSpawn } from './materializeConnectedServicesForSpawn';
import { resolveConnectedServiceMaterializedRootDir } from './resolveConnectedServiceMaterializedRootDir';

const firstHooks = '{"hooks":{"Stop":[]}}\n';
const secondHooks = '{"hooks":{"SessionStart":[]}}\n';

it('migrates linked hooks and preserves profile hook state through repeated staged materialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-codex-hooks-canary-'));
  const sourceHome = join(root, 'source-codex-home');
  const baseDir = join(root, 'materialized');
  const activeServerDir = join(root, 'server');
  const materializationKey = 'synthetic-codex-hooks-canary';
  const materializationRoot = resolveConnectedServiceMaterializedRootDir({
    baseDir,
    agentId: 'codex',
    materializationKey,
  });
  const targetHome = join(materializationRoot, 'codex-home');
  const sourceHooksPath = join(sourceHome, 'hooks.json');
  const targetHooksPath = join(targetHome, 'hooks.json');
  const record = buildConnectedServiceCredentialRecord({
    now: 10,
    serviceId: 'openai-codex',
    profileId: 'synthetic',
    kind: 'oauth',
    expiresAt: null,
    oauth: {
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      idToken: 'synthetic-id',
      scope: null,
      tokenType: null,
      providerAccountId: 'synthetic-account',
      providerEmail: null,
    },
  });

  try {
    await mkdir(sourceHome, { recursive: true });
    await mkdir(targetHome, { recursive: true });
    await mkdir(activeServerDir, { recursive: true });
    await writeFile(sourceHooksPath, firstHooks);
    await symlink(sourceHooksPath, targetHooksPath, 'file');
    await writeFile(join(targetHome, '.happier-state-sharing.json'), JSON.stringify({
      v: 1,
      requestedStateMode: 'isolated',
      effectiveStateMode: 'isolated',
      configEntries: ['hooks.json'],
      stateEntries: [],
    }));
    expect((await lstat(targetHooksPath)).isSymbolicLink()).toBe(true);

    const accountSettings = {
      connectedServicesProviderStateSharingSettingsV1: {
        v: 1,
        defaults: { configMode: 'linked', stateMode: 'isolated' },
        byAgentId: { codex: { configMode: 'linked', stateMode: 'isolated' } },
        acknowledgedRisksByAgentId: {},
      },
    };
    const materialize = async () => await materializeConnectedServicesForSpawn({
      agentId: 'codex',
      materializationKey,
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['openai-codex', record]]),
      accountSettings,
      processEnv: { CODEX_HOME: sourceHome, HOME: root },
    });
    const first = await materialize();
    expect(first?.env.CODEX_HOME).toBe(targetHome);
    expect((await lstat(targetHooksPath)).isFile()).toBe(true);
    expect((await lstat(targetHooksPath)).isSymbolicLink()).toBe(false);
    await expect(readFile(targetHooksPath, 'utf8')).resolves.toBe(firstHooks);
    expect((await readConnectedServiceStateSharingManifest(targetHome)).configEntries).toContain('hooks.json');
    const hookId = `${targetHooksPath}:stop:0:0`;
    const trustedHash = `sha256:${'a'.repeat(64)}`;
    await writeFile(join(targetHome, 'config.toml'),
      `[hooks.state.${JSON.stringify(hookId)}]\nenabled = false\ntrusted_hash = "${trustedHash}"\n`);

    await writeFile(sourceHooksPath, secondHooks);
    await expect(readFile(targetHooksPath, 'utf8')).resolves.toBe(firstHooks);
    const second = await materialize();
    expect(second?.env.CODEX_HOME).toBe(targetHome);
    expect((await lstat(targetHooksPath)).isFile()).toBe(true);
    expect((await lstat(targetHooksPath)).isSymbolicLink()).toBe(false);
    await expect(readFile(targetHooksPath, 'utf8')).resolves.toBe(secondHooks);
    const config = parse(await readFile(join(targetHome, 'config.toml'), 'utf8'));
    expect(config).toMatchObject({
      cli_auth_credentials_store: 'file',
      hooks: { state: { [hookId]: { enabled: false, trusted_hash: trustedHash } } },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
