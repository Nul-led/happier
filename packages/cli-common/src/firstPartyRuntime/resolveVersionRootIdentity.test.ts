import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveFirstPartyInstallLayout } from './installLayout.js';
import {
  FirstPartyVersionRootIdentityError,
  resolveFirstPartyVersionRootIdentity,
} from './resolveVersionRootIdentity.js';

describe('resolveFirstPartyVersionRootIdentity', () => {
  it('resolves current through its canonical marker to the immutable version root', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-version-root-current-'));
    const layout = resolveFirstPartyInstallLayout({
      componentId: 'happier-cli',
      channel: 'publicdev',
      processEnv: { ...process.env, HAPPIER_HOME_DIR: homeDir },
    });
    const versionRoot = join(layout.versionsDir, 'version-a');
    try {
      await mkdir(versionRoot, { recursive: true });
      await writeFile(join(layout.installRoot, 'current.version'), 'version-a\n', 'utf8');

      expect(resolveFirstPartyVersionRootIdentity({
        layout,
        runtimeRoot: layout.currentPath,
      })).toEqual({
        root: versionRoot,
        versionRootId: 'version-a',
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('keeps an exact versions child as the stable identity', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-version-root-direct-'));
    const layout = resolveFirstPartyInstallLayout({
      componentId: 'happier-cli',
      channel: 'preview',
      processEnv: { ...process.env, HAPPIER_HOME_DIR: homeDir },
    });
    const versionRoot = join(layout.versionsDir, 'version-a');
    try {
      await mkdir(versionRoot, { recursive: true });

      expect(resolveFirstPartyVersionRootIdentity({
        layout,
        runtimeRoot: versionRoot,
      })).toEqual({
        root: versionRoot,
        versionRootId: 'version-a',
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['a mutable pointer without a marker', 'current'],
    ['a nested version path', join('versions', 'version-a', 'nested')],
    ['a path outside the install layout', '..'],
  ])('fails typed for %s', async (_label, relativeRuntimeRoot) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-version-root-invalid-'));
    const layout = resolveFirstPartyInstallLayout({
      componentId: 'happier-cli',
      channel: 'stable',
      processEnv: { ...process.env, HAPPIER_HOME_DIR: homeDir },
    });
    try {
      expect(() => resolveFirstPartyVersionRootIdentity({
        layout,
        runtimeRoot: join(layout.installRoot, relativeRuntimeRoot),
      })).toThrow(FirstPartyVersionRootIdentityError);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
