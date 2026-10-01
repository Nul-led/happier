import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCachedCliUpdateState, recordCliUpdateCheck, resolveCliUpdateCachePath } from './index.js';

describe('CLI update-check cache (plan R13 S-1: one reader, one writer)', () => {
  let happierHomeDir = '';
  beforeEach(async () => {
    happierHomeDir = await mkdtemp(join(tmpdir(), 'happier-cli-update-cache-'));
  });
  afterEach(async () => {
    await rm(happierHomeDir, { recursive: true, force: true });
  });

  it('never records another ring\'s version as the latest', async () => {
    // preview and dev share npm's `next` dist-tag: a dev build must not become preview's latest.
    recordCliUpdateCheck({
      happierHomeDir,
      publicReleaseRing: 'preview',
      latest: '0.3.20-dev.4',
      current: '0.3.13-preview.2',
      runtimeVersion: null,
      invokerVersion: '0.3.13-preview.2',
      nowMs: 1_000,
    });
    const cached = JSON.parse(await readFile(resolveCliUpdateCachePath({ happierHomeDir, channelLabel: 'preview' }), 'utf8'));
    expect(cached).toMatchObject({ checkedAt: 1_000, latest: null, updateAvailable: false });
  });

  it('compares the ring\'s latest with the version actually running, and preserves the notice time', async () => {
    const cachePath = resolveCliUpdateCachePath({ happierHomeDir, channelLabel: 'stable' });
    await mkdir(join(happierHomeDir, 'cache'), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ checkedAt: 1, latest: '0.3.12', notifiedAt: 77 }));

    recordCliUpdateCheck({
      happierHomeDir,
      publicReleaseRing: 'stable',
      latest: '0.3.14',
      current: '0.3.13',
      runtimeVersion: null,
      invokerVersion: '0.3.13',
      nowMs: 2_000,
    });
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({ latest: '0.3.14', updateAvailable: true, notifiedAt: 77 });

    expect(readCachedCliUpdateState({ happierHomeDir, publicReleaseRing: 'stable', currentVersion: '0.3.13' }))
      .toEqual({ currentVersion: '0.3.13', latestVersion: '0.3.14', updateAvailable: true, checkedAt: 2_000 });
    // Updated since the check: no update is reported even though the cache said so.
    expect(readCachedCliUpdateState({ happierHomeDir, publicReleaseRing: 'stable', currentVersion: '0.3.14' }))
      .toMatchObject({ latestVersion: '0.3.14', updateAvailable: false });
  });

  it('reads a cache an older writer filled with another ring\'s version as unknown', async () => {
    const cachePath = resolveCliUpdateCachePath({ happierHomeDir, channelLabel: 'dev' });
    await mkdir(join(happierHomeDir, 'cache'), { recursive: true });
    // What the pre-S-1 doctor repair wrote: npm `next`, unfiltered, `updateAvailable: true` unconditionally.
    await writeFile(cachePath, JSON.stringify({ checkedAt: 5, latest: '0.3.20-preview.1', updateAvailable: true }));
    expect(readCachedCliUpdateState({ happierHomeDir, publicReleaseRing: 'publicdev', currentVersion: '0.3.13-dev.1' }))
      .toEqual({ currentVersion: '0.3.13-dev.1', latestVersion: null, updateAvailable: false, checkedAt: 5 });
  });
});
