import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { initialMachineMetadata, refreshMachineMetadataForCurrentDaemon } from './metadata';

describe('initialMachineMetadata', () => {
  it('reads the fallback host name when metadata is consumed, not at module load', () => {
    const hostname = vi.spyOn(os, 'hostname').mockReturnValue('renamed-host.local');
    try {
      expect(initialMachineMetadata.host).toBe('renamed-host.local');
    } finally {
      hostname.mockRestore();
    }
  });

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

  it('publishes the daemon\'s CLI update facts (K5) and republishes only when they change', () => {
    const cliUpdate = {
      currentVersion: '0.3.1',
      latestVersion: '0.3.2',
      channel: 'stable' as const,
      installSource: 'managed' as const,
      updateCommand: 'happier self update',
      canUpdateRemotely: true,
      lastUpdate: { targetVersion: '0.3.1', outcome: 'succeeded' as const, at: 5, message: null },
    };
    const fields = {
      host: initialMachineMetadata.host,
      platform: initialMachineMetadata.platform,
      happyCliVersion: initialMachineMetadata.happyCliVersion,
      homeDir: initialMachineMetadata.homeDir,
      happyHomeDir: initialMachineMetadata.happyHomeDir,
      happyLibDir: initialMachineMetadata.happyLibDir,
    };
    const published = refreshMachineMetadataForCurrentDaemon(initialMachineMetadata, { ...fields, cliUpdate });
    expect(published).toMatchObject({ cliUpdate });
    expect(refreshMachineMetadataForCurrentDaemon(published, { ...fields, cliUpdate: { ...cliUpdate } })).toBe(published);
    const rolledBack = { ...cliUpdate, lastUpdate: { targetVersion: '0.3.2', outcome: 'rolledBack' as const, at: 9, message: 'restored' } };
    expect(refreshMachineMetadataForCurrentDaemon(published, { ...fields, cliUpdate: rolledBack })).toMatchObject({ cliUpdate: rolledBack });
  });
});
