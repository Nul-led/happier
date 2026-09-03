import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildServerBinaryArtifactPayload,
  SERVER_BINARY_DEFAULT_EXTERNALS,
} from './buildServerBinaryArtifactPayload.js';

type CapturedCompile = { externals?: readonly string[] };

const createdRoots: string[] = [];

function createServerSourceRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'happier-server-externals-'));
  createdRoots.push(repoRoot);
  writeFileSync(join(repoRoot, 'main.light.ts'), 'export {};\n', 'utf8');
  mkdirSync(join(repoRoot, 'apps', 'server', 'sources'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'apps', 'server', 'sources', 'main.light.ts'),
    'export {};\n',
    'utf8',
  );
  return repoRoot;
}

afterEach(() => {
  while (createdRoots.length > 0) {
    rmSync(createdRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('buildServerBinaryArtifactPayload externals', () => {
  it('externalizes the optional expo native probe boundary so React Native sources cannot enter the server bundle', async () => {
    // @happier-dev/iroh-native's root entry performs a guarded optional
    // require('expo-modules-core') for the React Native availability probe.
    // A static require must stay external in the server Bun build: if the
    // bundler resolves it, expo-modules-core drags react-native (Flow
    // sources reached through the root-hoisted react-native symlink) into
    // the graph and the server publication fails to parse.
    const repoRoot = createServerSourceRepoRoot();
    const compileCalls: CapturedCompile[] = [];

    await buildServerBinaryArtifactPayload({
      repoRoot,
      payloadDir: join(repoRoot, 'payload'),
      includeRuntimeSupport: false,
      serverComponent: 'happier-server-light',
      buildDbProviders: 'sqlite',
      env: {},
      runCommand: async () => undefined,
      commandProbe: () => true,
      compileBinary: (async (options: CapturedCompile) => {
        compileCalls.push(options);
        return { entrypoint: 'happier-server' };
      }) as never,
      compilePrismaBinary: (async () => undefined) as never,
    });

    expect(compileCalls.length).toBeGreaterThan(0);
    for (const call of compileCalls) {
      expect(call.externals).toContain('expo-modules-core');
    }
    expect(SERVER_BINARY_DEFAULT_EXTERNALS).toContain('expo-modules-core');
  });
});
