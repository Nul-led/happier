import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listMachineBrowseDirectory } from '@/rpc/handlers/machineFileBrowser/listMachineBrowseDirectory';
import { createScmBackendRegistry } from '@/scm/registry';
import { createRegisteredScmBackendAdapter } from '@/scm/pluginBackends/registeredScmBackendAdapter';
import { createGitScmBackendRuntimeRegistration } from '../../../../../../../packages/plugins/scm-git/src/backend';

import { listDirectoryEntries } from './listDirectoryEntries';

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'happier-directory-listing-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (!directory) continue;
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('listDirectoryEntries', () => {
  it('sorts directories before files and returns direct children only', async () => {
    const root = createTempDirectory();
    mkdirSync(join(root, 'z-folder'));
    mkdirSync(join(root, 'a-folder'));
    mkdirSync(join(root, 'a-folder', 'nested'));
    writeFileSync(join(root, 'b-file.txt'), 'b');
    writeFileSync(join(root, 'a-file.txt'), 'a');

    const result = await listDirectoryEntries({
      directoryPath: root,
      includeFiles: true,
      maxEntries: null,
      statConcurrency: 4,
    });

    expect(result.truncated).toBe(false);
    expect(result.entries.map((entry) => [entry.name, entry.type])).toEqual([
      ['a-folder', 'directory'],
      ['z-folder', 'directory'],
      ['a-file.txt', 'file'],
      ['b-file.txt', 'file'],
    ]);
    expect(result.entries.some((entry) => entry.absolutePath.endsWith('nested'))).toBe(false);
  });

  it('classifies through the registered Git plugin without hiding raw entries', async () => {
    const root = createTempDirectory();
    execFileSync('git', ['init'], { cwd: root });
    mkdirSync(join(root, 'build'));
    mkdirSync(join(root, '.github'));
    writeFileSync(join(root, '.gitignore'), '*.log\nbuild/\n');
    writeFileSync(join(root, 'tracked.log'), 'tracked');
    writeFileSync(join(root, 'noise.log'), 'ignored');
    writeFileSync(join(root, 'build', 'tracked.txt'), 'tracked');
    writeFileSync(join(root, 'build', 'noise.log'), 'ignored');
    execFileSync('git', ['add', '-f', 'tracked.log', 'build/tracked.txt'], { cwd: root });
    const registration = createGitScmBackendRuntimeRegistration();
    if (!registration.runtime) throw new Error('Git SCM registration must declare its executable definition');
    const registry = createScmBackendRegistry([createRegisteredScmBackendAdapter({
      definition: { id: 'git' }, qualifiedId: 'test:git',
      executableDefinition: registration.runtime, registration,
    })]);
    const list = (directoryPath: string, includeGitIgnore = true) => listDirectoryEntries({
      directoryPath, includeFiles: true, maxEntries: null, statConcurrency: 4, includeGitIgnore, scmRegistry: registry,
    });
    const raw = await list(root, false);
    expect(raw.gitIgnoreAvailable).toBeUndefined();
    expect(raw.entries.every((entry) => entry.gitIgnored === undefined)).toBe(true);
    const classified = await list(root);
    expect(classified.gitIgnoreAvailable).toBe(true);
    expect(Object.fromEntries(classified.entries.map((entry) => [entry.name, entry.gitIgnored]))).toEqual({
      '.git': true, '.gitignore': false, '.github': false, build: false, 'tracked.log': false, 'noise.log': true,
    });
    const machine = await listMachineBrowseDirectory({
      raw: { path: root, includeGitIgnore: true }, roots: [{ id: root, label: root, path: root }],
      maxEntries: 200, statConcurrency: 4, scmRegistry: registry,
    });
    expect(machine).toMatchObject({ ok: true, gitIgnoreAvailable: true });
    if (machine.ok) expect(Object.fromEntries(machine.entries.map((entry) => [entry.name, entry.gitIgnored])))
      .toEqual(Object.fromEntries(classified.entries.map((entry) => [entry.name, entry.gitIgnored])));
    const nested = await list(join(root, 'build'));
    expect(Object.fromEntries(nested.entries.map((entry) => [entry.name, entry.gitIgnored]))).toEqual({
      'tracked.txt': false, 'noise.log': true,
    });
    writeFileSync(join(root, '.git', 'index'), 'invalid index');
    const failed = await list(root);
    expect(failed.gitIgnoreAvailable).toBe(false);
    expect(failed.entries.map((entry) => entry.name)).toEqual(raw.entries.map((entry) => entry.name));
    expect(failed.entries.every((entry) => entry.gitIgnored === undefined)).toBe(true);
    const outside = createTempDirectory();
    writeFileSync(join(outside, 'keep.log'), 'keep');
    const unavailable = await list(outside);
    expect(unavailable.gitIgnoreAvailable).toBe(false);
    expect(unavailable.entries.map((entry) => entry.name)).toEqual(['keep.log']);
  });

  it('can hide files and report truncation when maxEntries is applied', async () => {
    const root = createTempDirectory();
    mkdirSync(join(root, 'alpha'));
    mkdirSync(join(root, 'beta'));
    writeFileSync(join(root, 'notes.txt'), 'hello');

    const directoriesOnly = await listDirectoryEntries({
      directoryPath: root,
      includeFiles: false,
      maxEntries: null,
      statConcurrency: 4,
    });

    expect(directoriesOnly.entries.map((entry) => entry.name)).toEqual(['alpha', 'beta']);

    const truncated = await listDirectoryEntries({
      directoryPath: root,
      includeFiles: true,
      maxEntries: 2,
      statConcurrency: 4,
    });

    expect(truncated.entries).toHaveLength(2);
    expect(truncated.truncated).toBe(true);
  });
});
