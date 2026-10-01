import os from 'os';

import { readLocalHostIdentity, readPreferredHostName } from '@happier-dev/cli-common/process';

import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import type { MachineMetadata } from '@/api/types';
import packageJson from '../../../package.json';

export async function getPreferredHostName(): Promise<string> {
  return await readPreferredHostName();
}

type CurrentDaemonMachineMetadataFields = Pick<
  MachineMetadata,
  'host' | 'platform' | 'happyCliVersion' | 'homeDir' | 'happyHomeDir' | 'happyLibDir'
> & Partial<Pick<MachineMetadata, 'cliUpdate'>>;

/**
 * The daemon-owned metadata fields, refreshed without touching user-owned ones (e.g.
 * `displayName`). `cliUpdate` is the daemon's K5 CLI update facts (plan R13): absent from a caller
 * that does not produce them, which leaves the stored facts as they were.
 */

export function refreshMachineMetadataForCurrentDaemon(
  current: Partial<MachineMetadata>,
  fields: CurrentDaemonMachineMetadataFields,
): MachineMetadata {
  const { cliUpdate, ...ownedFields } = fields;
  const next: MachineMetadata = {
    ...current,
    ...ownedFields,
    ...(cliUpdate ? { cliUpdate } : {}),
    daemonTerminalSessionAttachSupported: true,
    daemonSessionGoalControlsSupported: true,
  };
  if (
    current.host === next.host
    && current.platform === next.platform
    && current.happyCliVersion === next.happyCliVersion
    && current.homeDir === next.homeDir
    && current.happyHomeDir === next.happyHomeDir
    && current.happyLibDir === next.happyLibDir
    && current.daemonTerminalSessionAttachSupported === next.daemonTerminalSessionAttachSupported
    && current.daemonSessionGoalControlsSupported === next.daemonSessionGoalControlsSupported
    && JSON.stringify(current.cliUpdate ?? null) === JSON.stringify(next.cliUpdate ?? null)
  ) {
    return current as MachineMetadata;
  }
  return next;
}

const initialDaemonMetadata = refreshMachineMetadataForCurrentDaemon({}, {
  host: '',
  platform: readLocalHostIdentity().platform,
  happyCliVersion: packageJson.version,
  homeDir: os.homedir(),
  happyHomeDir: configuration.happyHomeDir,
  happyLibDir: projectPath(),
});

export const initialMachineMetadata: MachineMetadata = {
  ...initialDaemonMetadata,
  get host() {
    return readLocalHostIdentity().machineName;
  },
};
