import { describe, expect, it } from 'vitest';

import { initialMachineMetadata, refreshMachineMetadataForCurrentDaemon } from './metadata';

describe('initialMachineMetadata', () => {
  it('advertises daemon-owned runtime control capabilities', () => {
    expect(initialMachineMetadata.daemonTerminalSessionAttachSupported).toBe(true);
    expect(initialMachineMetadata.daemonSessionGoalControlsSupported).toBe(true);
  });

  it('refreshes owner fields without dropping user-owned metadata', () => {
    const current = {
      host: 'old-host',
      platform: 'darwin',
      happyCliVersion: 'old',
      homeDir: '/old-home',
      happyHomeDir: '/old-happier-home',
      happyLibDir: '/old-lib',
      displayName: 'Company gateway',
    };

    expect(refreshMachineMetadataForCurrentDaemon(current, {
      host: 'new-host',
      platform: 'linux',
      happyCliVersion: 'new',
      homeDir: '/new-home',
      happyHomeDir: '/new-happier-home',
      happyLibDir: '/new-lib',
    })).toEqual({
      ...current,
      host: 'new-host',
      platform: 'linux',
      happyCliVersion: 'new',
      homeDir: '/new-home',
      happyHomeDir: '/new-happier-home',
      happyLibDir: '/new-lib',
      daemonTerminalSessionAttachSupported: true,
      daemonSessionGoalControlsSupported: true,
    });
  });

  it('returns the existing metadata object when every daemon-owned field is current', () => {
    const current = {
      ...initialMachineMetadata,
      displayName: 'Build box',
    };

    expect(refreshMachineMetadataForCurrentDaemon(current, {
      host: current.host,
      platform: current.platform,
      happyCliVersion: current.happyCliVersion,
      homeDir: current.homeDir,
      happyHomeDir: current.happyHomeDir,
      happyLibDir: current.happyLibDir,
    })).toBe(current);
  });
});
