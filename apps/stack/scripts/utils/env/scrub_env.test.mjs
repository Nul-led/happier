import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createTempFixture } from '../../testkit/core/temp_fixture.mjs';

import {
  SANDBOX_PRESERVE_KEYS,
  STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS,
  STACK_WRAPPER_PRESERVE_KEYS,
  scrubHappierStackEnv,
  readBundledAgentNativeHomeEnvironmentKeys,
} from './scrub_env.mjs';

test('Agent home projection accepts generated TS/JS and rejects unavailable or malformed authority', async (t) => {
  const { root } = await createTempFixture(t, { prefix: 'hstack-agent-homes-' });
  const path = join(root, 'facts.ts');
  const readKeys = () => readBundledAgentNativeHomeEnvironmentKeys(path);
  assert.throws(readKeys, /native-home projection/u);
  for (const declaration of [
    '',
    'export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS = Object.freeze(null);',
    'export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS = Object.freeze(["NOT A KEY"]);',
  ]) {
    await writeFile(path, declaration);
    assert.throws(readKeys, /native-home projection/u);
  }
  for (const annotation of [': readonly string[]', '']) {
    await writeFile(path, `export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS${annotation} = Object.freeze(["CUSTOM_AGENT_ROOT", "customAgent_home"]);`);
    assert.deepEqual(readKeys(), ['CUSTOM_AGENT_ROOT', 'customAgent_home']);
  }
  await writeFile(path, 'export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS = Object.freeze([]);');
  assert.deepEqual(readKeys(), []);
});

test('stack wrapper scrubs native-home keys supplied by the generated Agent projection', async (t) => {
  const { root } = await createTempFixture(t, { prefix: 'hstack-agent-home-policy-' });
  const policyPath = join(root, 'apps/stack/scripts/utils/env/scrub_env.mjs');
  const agentsPath = join(root, 'packages/agents');
  await mkdir(dirname(policyPath), { recursive: true });
  await mkdir(join(agentsPath, 'src/generated'), { recursive: true });
  await copyFile(new URL('./scrub_env.mjs', import.meta.url), policyPath);
  await writeFile(join(agentsPath, 'package.json'), '{}');
  await writeFile(join(agentsPath, 'src/generated/bundledAgentDefinitions.ts'),
    'export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS: readonly string[] | null = Object.freeze(["CUSTOM_AGENT_ROOT"]);');
  const policy = await import(pathToFileURL(policyPath).href);
  const scrubbed = policy.scrubHappierStackEnv({ CUSTOM_AGENT_ROOT: '/foreign-home', PATH: '/bin' }, {
    clearUnprefixedKeys: policy.STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS,
  });
  assert.ok(scrubbed.CUSTOM_AGENT_ROOT === undefined, 'generated native-home key must be scrubbed');
  assert.ok(scrubbed.PATH === '/bin', 'unrelated environment must be retained');
});

test('scrubHappierStackEnv removes non-preserved HAPPIER_STACK_* vars and clears selected unprefixed keys', () => {
  const env = {
    PATH: '/bin',
    HAPPIER_STACK_VERBOSE: '1',
    HAPPIER_STACK_FOO: 'bar',
    HAPPIER_HOME_DIR: '/tmp/happier-home',
    HAPPIER_SERVER_URL: 'http://example.com',
  };

  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: SANDBOX_PRESERVE_KEYS,
    clearUnprefixedKeys: ['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL'],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.HAPPIER_STACK_VERBOSE, '1');
  assert.equal(scrubbed.HAPPIER_STACK_FOO, undefined);
  assert.equal(scrubbed.HAPPIER_HOME_DIR, undefined);
  assert.equal(scrubbed.HAPPIER_SERVER_URL, undefined);
});

test('scrubHappierStackEnv keeps runtime-critical non-HAPPIER env keys', () => {
  const env = {
    PATH: '/bin:/usr/bin',
    HOME: '/tmp/home',
    TMPDIR: '/tmp',
    SHELL: '/bin/zsh',
    HAPPIER_STACK_SECRET: 'drop-me',
  };

  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: [],
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.PATH, '/bin:/usr/bin');
  assert.equal(scrubbed.HOME, '/tmp/home');
  assert.equal(scrubbed.TMPDIR, '/tmp');
  assert.equal(scrubbed.SHELL, '/bin/zsh');
  assert.equal(scrubbed.HAPPIER_STACK_SECRET, undefined);
});

test('scrubHappierStackEnv preserves only explicitly kept HAPPIER_STACK keys', () => {
  const env = {
    HAPPIER_STACK_VERBOSE: '1',
    HAPPIER_STACK_SANDBOX_DIR: '/tmp/sandbox',
    HAPPIER_STACK_SECRET: 'drop-me',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: [' HAPPIER_STACK_SANDBOX_DIR ', ''],
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.HAPPIER_STACK_SANDBOX_DIR, '/tmp/sandbox');
  assert.equal(scrubbed.HAPPIER_STACK_VERBOSE, undefined);
  assert.equal(scrubbed.HAPPIER_STACK_SECRET, undefined);
});

test('scrubHappierStackEnv trims and de-duplicates clearUnprefixedKeys', () => {
  const env = {
    PATH: '/bin',
    HAPPIER_HOME_DIR: '/tmp/home',
    HAPPIER_SERVER_URL: 'http://localhost:3000',
    HAPPIER_STACK_KEEP: 'keep',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: ['HAPPIER_STACK_KEEP'],
    clearUnprefixedKeys: [' HAPPIER_HOME_DIR ', 'HAPPIER_SERVER_URL', 'HAPPIER_SERVER_URL'],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.HAPPIER_HOME_DIR, undefined);
  assert.equal(scrubbed.HAPPIER_SERVER_URL, undefined);
  assert.equal(scrubbed.HAPPIER_STACK_KEEP, 'keep');
});

test('scrubHappierStackEnv preserves HAPPIER_STACK_TUI in stack wrapper mode', () => {
  const env = {
    PATH: '/bin',
    HAPPIER_STACK_TUI: '1',
    HAPPIER_STACK_RESCUE: '1',
    HAPPIER_STACK_VERBOSE: '1',
    HAPPIER_STACK_SECRET: 'drop-me',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: STACK_WRAPPER_PRESERVE_KEYS,
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.HAPPIER_STACK_TUI, '1');
  assert.equal(scrubbed.HAPPIER_STACK_RESCUE, '1');
  assert.equal(scrubbed.HAPPIER_STACK_VERBOSE, '1');
  assert.equal(scrubbed.HAPPIER_STACK_SECRET, undefined);
});

test('scrubHappierStackEnv preserves stack wrapper routing and runtime selection keys', () => {
  const env = {
    HAPPIER_STACK_ENV_FILE: '/tmp/stack/env',
    HAPPIER_STACK_STACK: 'dev',
    HAPPIER_STACK_OWNER: 'alice',
    HAPPIER_STACK_REPO_DIR: '/tmp/repo',
    HAPPIER_STACK_RUNTIME_MODE: 'require',
    HAPPIER_STACK_RUNTIME_STATE_PATH: '/tmp/stack/stack.runtime.json',
    HAPPIER_STACK_DAEMON: '0',
    HAPPIER_STACK_CLI_HOME_DIR: '/tmp/stack/cli',
    HAPPIER_STACK_CLI_IDENTITY: 'default',
    HAPPIER_STACK_INVOKED_CWD: '/tmp/plugin-author-root',
    HAPPIER_STACK_SECRET: 'drop-me',
  };

  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: STACK_WRAPPER_PRESERVE_KEYS,
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.HAPPIER_STACK_ENV_FILE, '/tmp/stack/env');
  assert.equal(scrubbed.HAPPIER_STACK_STACK, 'dev');
  assert.equal(scrubbed.HAPPIER_STACK_OWNER, 'alice');
  assert.equal(scrubbed.HAPPIER_STACK_REPO_DIR, '/tmp/repo');
  assert.equal(scrubbed.HAPPIER_STACK_RUNTIME_MODE, 'require');
  assert.equal(scrubbed.HAPPIER_STACK_RUNTIME_STATE_PATH, '/tmp/stack/stack.runtime.json');
  assert.equal(scrubbed.HAPPIER_STACK_DAEMON, '0');
  assert.equal(scrubbed.HAPPIER_STACK_CLI_HOME_DIR, '/tmp/stack/cli');
  assert.equal(scrubbed.HAPPIER_STACK_CLI_IDENTITY, 'default');
  assert.equal(scrubbed.HAPPIER_STACK_INVOKED_CWD, '/tmp/plugin-author-root');
  assert.equal(scrubbed.HAPPIER_STACK_SECRET, undefined);
});

test('STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS covers stale cross-stack runtime and server context', () => {
  for (const key of [
    'CODEX_HOME',
    'CLAUDE_CONFIG_DIR',
    'PI_CODING_AGENT_DIR',
    'HAPPIER_HOME_DIR',
    'HAPPIER_SERVER_URL',
    'HAPPIER_PUBLIC_SERVER_URL',
    'HAPPIER_LOCAL_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_ACTIVE_SERVER_ID',
    'HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT',
    'TSX_TSCONFIG_PATH',
  ]) {
    assert.ok(
      STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS.includes(key),
      `expected ${key} to be cleared for stack-wrapper invocations`,
    );
  }

  const scrubbed = scrubHappierStackEnv(
    Object.fromEntries(STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS.map((key) => [key, `stale-${key}`])),
    {
      keepHappierStackKeys: STACK_WRAPPER_PRESERVE_KEYS,
      clearUnprefixedKeys: STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS,
    },
  );

  for (const key of STACK_WRAPPER_CLEAR_UNPREFIXED_KEYS) {
    assert.equal(scrubbed[key], undefined, `expected ${key} to be scrubbed`);
  }
});
