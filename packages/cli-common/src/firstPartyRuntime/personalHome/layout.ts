import { homedir } from 'node:os';
import { normalize, posix, resolve, win32 } from 'node:path';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { resolveRelayRuntimeDefaults } from '../relayRuntime.js';
import { expandHomeDirPath } from '../../path/expandHomeDirPath.js';
import {
  resolveManagedServerLightPathEnvValue,
  resolvePersonalHomePrivateFilesDir,
  resolvePersonalHomeSqliteDatabasePath,
} from './pathResolvers.js';

export type PersonalHomeRuntimeLayout = Readonly<{
  installRoot: string;
  configDir: string;
  dataDir: string;
  databasePath: string;
  publicFilesDir: string;
  privateFilesDir: string;
  masterSecretPath: string;
  backupsDir: string;
  derivedDataDir: string;
  logsDir: string;
  // These fields are retained while the in-flight operations lane consumes this shape.
  irohEndpointKeyPath: string;
  mode: 'user' | 'system';
  platform: NodeJS.Platform;
}>;

export function resolvePersonalHomeRuntimeLayout(params: Readonly<{
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  mode?: 'user' | 'system';
  channel?: PublicReleaseRingId;
}> = {}): PersonalHomeRuntimeLayout {
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const mode = params.mode ?? 'user';
  const fallbackHome = params.homeDir ?? homedir();
  const pathEnv: NodeJS.ProcessEnv = platform === 'win32'
    ? { ...env, USERPROFILE: fallbackHome }
    : { ...env, HOME: fallbackHome };
  const defaults = resolveRelayRuntimeDefaults({ platform, mode, channel: params.channel ?? 'stable', homeDir: fallbackHome });
  const api = platform === 'win32' ? win32 : posix;
  const absolute = (value: string): string => api.resolve(expandHomeDirPath(value, pathEnv, platform));
  const installRoot = absolute(String(env.HAPPIER_SELF_HOST_INSTALL_ROOT ?? defaults.installRoot));
  const configDir = absolute(String(env.HAPPIER_SELF_HOST_CONFIG_DIR ?? defaults.configDir));
  const dataDir = absolute(
    resolveManagedServerLightPathEnvValue(env, 'HAPPIER_SERVER_LIGHT_DATA_DIR', 'HAPPY_SERVER_LIGHT_DATA_DIR')
      || defaults.dataDir,
  );
  const filesDir = absolute(
    resolveManagedServerLightPathEnvValue(env, 'HAPPIER_SERVER_LIGHT_FILES_DIR', 'HAPPY_SERVER_LIGHT_FILES_DIR')
      || api.join(dataDir, 'files'),
  );
  const databasePath = resolvePersonalHomeSqliteDatabasePath({ dataDir, env: pathEnv, platform });
  const logsDir = absolute(String(env.HAPPIER_SELF_HOST_LOG_DIR ?? defaults.logDir));
  const privateFilesDir = resolvePersonalHomePrivateFilesDir({ dataDir, env: pathEnv, platform });
  return Object.freeze({ installRoot, configDir, dataDir, databasePath, publicFilesDir: filesDir, privateFilesDir,
    masterSecretPath: api.resolve(api.join(dataDir, 'handy-master-secret.txt')),
    backupsDir: api.resolve(api.join(dataDir, 'backups')), derivedDataDir: api.resolve(api.join(dataDir, 'derived')), logsDir,
    irohEndpointKeyPath: api.resolve(api.join(dataDir, 'runtime', 'iroh', 'endpoint.key')), mode, platform });
}

export function assertLayoutPath(layout: PersonalHomeRuntimeLayout, path: string): string {
  const root = normalize(resolve(layout.dataDir));
  const candidate = normalize(resolve(path));
  if (candidate !== root && !candidate.startsWith(`${root}/`) && !candidate.startsWith(`${root}\\`)) {
    throw new Error('Personal Home path escapes data root');
  }
  return candidate;
}
