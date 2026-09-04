import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { withTempDir } from '@/testkit/fs/tempDir';

import {
  CLI_HOME_DESCRIPTOR_MAX_BYTES,
  parseCliHomeTargetArgs,
  projectCliHomeTargetToServerSelectionArgs,
} from './homeTargetCliArgs';

const descriptor: HomeConnectionDescriptorV1 = {
  v: 1,
  homeServerIdentityId: 'srv_cli_args_home',
  canonicalServerUrl: 'http://127.0.0.1:3005',
  revision: 1,
  endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
};

describe('CLI Home target arguments', () => {
  it('normalizes each canonical target form into the closed HomeTargetInput owner', async () => {
    await expect(parseCliHomeTargetArgs(['--home', 'studio', '--yes']))
      .resolves.toEqual({
        target: { kind: 'saved_profile', profileRef: 'studio' },
        source: '--home',
        rest: ['--yes'],
      });

    await expect(parseCliHomeTargetArgs([
      '--home-url=https://home.example.test/',
      '--local-server-url',
      'http://127.0.0.1:3005',
      '--webapp-url=https://app.example.test/',
      '--skip-daemon',
    ])).resolves.toEqual({
      target: {
        kind: 'https_url',
        url: 'https://home.example.test',
        localUrl: 'http://127.0.0.1:3005',
        webappUrl: 'https://app.example.test',
      },
      source: '--home-url',
      rest: ['--skip-daemon'],
    });

    const readDescriptorText = vi.fn(async () => JSON.stringify(descriptor));
    await expect(parseCliHomeTargetArgs(
      ['--home-descriptor-file', '-', '--skip-providers'],
      { readDescriptorText },
    )).resolves.toEqual({
      target: { kind: 'descriptor', descriptor, authority: 'trusted_enrollment' },
      source: '--home-descriptor-file',
      rest: ['--skip-providers'],
    });
    expect(readDescriptorText).toHaveBeenCalledWith('-', CLI_HOME_DESCRIPTOR_MAX_BYTES);
  });

  it('retains released setup aliases as thin inputs to the same target parser', async () => {
    await expect(parseCliHomeTargetArgs(['--server=cloud']))
      .resolves.toMatchObject({ target: { kind: 'saved_profile', profileRef: 'cloud' } });
    await expect(parseCliHomeTargetArgs(['--relay-url', 'https://legacy.example.test']))
      .resolves.toMatchObject({ target: { kind: 'https_url', url: 'https://legacy.example.test' } });
    await expect(parseCliHomeTargetArgs(['--server-url=https://legacy.example.test']))
      .resolves.toMatchObject({ target: { kind: 'https_url', url: 'https://legacy.example.test' } });
  });

  it('rejects competing targets before reading a descriptor or returning mutable work', async () => {
    const readDescriptorText = vi.fn(async () => JSON.stringify(descriptor));
    await expect(parseCliHomeTargetArgs(
      ['--home', 'studio', '--home-descriptor-file', '/tmp/home.json'],
      { readDescriptorText },
    )).rejects.toThrow('Use only one explicit Home target');
    expect(readDescriptorText).not.toHaveBeenCalled();

    await expect(parseCliHomeTargetArgs([
      '--home-url', 'https://one.example.test',
      '--server-url', 'https://two.example.test',
    ])).rejects.toThrow('Use only one explicit Home target');
  });

  it('bounds and strictly validates descriptor JSON', async () => {
    await expect(parseCliHomeTargetArgs(
      ['--home-descriptor-file', '/tmp/home.json'],
      { readDescriptorText: async () => `${JSON.stringify(descriptor)}${' '.repeat(CLI_HOME_DESCRIPTOR_MAX_BYTES)}` },
    )).rejects.toThrow('exceeds');

    await expect(parseCliHomeTargetArgs(
      ['--home-descriptor-file', '/tmp/home.json'],
      { readDescriptorText: async () => JSON.stringify({ ...descriptor, unexpected: true }) },
    )).rejects.toThrow('strict HomeConnectionDescriptorV1');
  });

  it('reads a descriptor file through the bounded production reader', async () => {
    await withTempDir('happier-home-target-args-', async (directory) => {
      const descriptorPath = join(directory, 'home.json');
      await writeFile(descriptorPath, JSON.stringify(descriptor), 'utf8');

      await expect(parseCliHomeTargetArgs(['--home-descriptor-file', descriptorPath]))
        .resolves.toMatchObject({
          target: { kind: 'descriptor', descriptor },
          rest: [],
        });

      await writeFile(descriptorPath, 'x'.repeat(CLI_HOME_DESCRIPTOR_MAX_BYTES + 1), 'utf8');
      await expect(parseCliHomeTargetArgs(['--home-descriptor-file', descriptorPath]))
        .rejects.toThrow('exceeds');
    });
  });

  it('projects saved and URL targets into the existing selection owner without descriptor ambiguity', async () => {
    const saved = await parseCliHomeTargetArgs(['--home', 'studio']);
    const url = await parseCliHomeTargetArgs([
      '--home-url', 'https://home.example.test',
      '--local-server-url', 'http://127.0.0.1:3005',
      '--webapp-url', 'https://app.example.test',
    ]);
    const descriptorTarget = await parseCliHomeTargetArgs(
      ['--home-descriptor-file', '-'],
      { readDescriptorText: async () => JSON.stringify(descriptor) },
    );

    expect(projectCliHomeTargetToServerSelectionArgs(saved.target!)).toEqual(['--server', 'studio']);
    expect(projectCliHomeTargetToServerSelectionArgs(url.target!)).toEqual([
      '--server-url', 'https://home.example.test',
      '--local-server-url', 'http://127.0.0.1:3005',
      '--webapp-url', 'https://app.example.test',
    ]);
    expect(() => projectCliHomeTargetToServerSelectionArgs(descriptorTarget.target!))
      .toThrow('Descriptor Home targets');
  });
});
