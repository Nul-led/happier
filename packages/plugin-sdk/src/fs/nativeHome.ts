/** @moduleRealm daemon */
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandHomePath, isCanonicalAbsolutePathInsideRoot, resolveHomeDirFromEnvironment } from '../sessions/fileStores/paths.js';

export function resolveConfiguredNativeHomePath(
  declaration: Readonly<{ environmentKey: string; defaultRelativePath: string }>,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const override = env[declaration.environmentKey]?.trim();
  const home = resolveHomeDirFromEnvironment(env);
  return override ? resolve(expandHomePath(override, home)) : resolve(home, declaration.defaultRelativePath);
}

/** Physical custody stops at the home: shared state inside it may intentionally be symlinked. */
export async function resolveVerifiedNativeHomePath(params: Readonly<{
  homesRoot: string;
  expectedPath: string;
  exactHomePath?: string | null;
  throwIfStopped?: () => void;
}>): Promise<string | null> {
  const check = params.throwIfStopped ?? (() => {});
  check();
  try {
    const targetPath = params.exactHomePath ?? params.expectedPath;
    const linkStats = await lstat(targetPath);
    check();
    if (linkStats.isSymbolicLink()) return null;
    const real = await realpath(targetPath);
    check();
    const expectedReal = await realpath(params.expectedPath).catch(() => null);
    check();
    if (!expectedReal || real !== expectedReal) return null;
    const homesRootReal = await realpath(params.homesRoot).catch(() => null);
    check();
    if (!homesRootReal || !isCanonicalAbsolutePathInsideRoot(homesRootReal, real)) return null;
    const stats = await stat(real);
    check();
    return stats.isDirectory() ? real : null;
  } catch {
    check();
    return null;
  }
}

export type ConnectedServiceNativeHome = Readonly<{
  homePath: string;
  profileId?: string;
  groupId?: string;
}>;

export async function listConnectedServiceNativeHomes(params: Readonly<{
  activeServerDir: string;
  serviceId: string;
  agentId: string;
  homeDirectoryName: string;
  throwIfStopped?: () => void;
}>): Promise<ConnectedServiceNativeHome[]> {
  const check = params.throwIfStopped ?? (() => {});
  check();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(params.serviceId)) return [];
  const homesRoot = join(params.activeServerDir, 'daemon', 'connected-services', 'homes');
  const serviceRoot = join(homesRoot, params.serviceId);
  const entries: ConnectedServiceNativeHome[] = [];
  let profiles: Dirent[];
  try {
    profiles = await readdir(serviceRoot, { withFileTypes: true });
  } catch {
    check();
    return [];
  }
  check();
  for (const profile of profiles) {
    check();
    const profileId = profile.name.trim();
    if (profile.name === '__groups' || !profile.isDirectory() || profile.isSymbolicLink()
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(profileId)) continue;
    const homePath = await resolveVerifiedNativeHomePath({
      homesRoot, expectedPath: join(serviceRoot, profileId, params.agentId, params.homeDirectoryName), throwIfStopped: check,
    });
    if (homePath) entries.push({ homePath, profileId });
  }
  const groupsRoot = join(serviceRoot, '__groups');
  const groups = await readdir(groupsRoot, { withFileTypes: true }).catch(() => []);
  check();
  for (const group of groups) {
    check();
    const groupId = group.name.trim();
    if (!group.isDirectory() || group.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(groupId)) continue;
    const homePath = await resolveVerifiedNativeHomePath({
      homesRoot, expectedPath: join(groupsRoot, groupId, params.agentId, params.homeDirectoryName), throwIfStopped: check,
    });
    if (homePath) entries.push({ homePath, groupId });
  }
  return entries;
}
