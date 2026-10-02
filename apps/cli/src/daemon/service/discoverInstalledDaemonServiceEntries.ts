import * as fs from 'node:fs';
import { spawnBackgroundSync } from '@happier-dev/cli-common/process';
import { basename, join, win32 as win32Path } from 'node:path';

import {
  parseLaunchdPlist,
  parseSystemdUnit,
  parseWindowsScheduledTaskWrapperPs1,
  resolveDaemonServiceTargetMode,
  type ParsedLaunchdPlist,
  type ParsedSystemdUnit,
  type ParsedWindowsScheduledTaskWrapperPs1,
} from '@happier-dev/cli-common/service';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import { readPositiveIntEnv } from '@/utils/readPositiveIntEnv';

import {
  DAEMON_SERVICE_MANAGED_BY_ENV_KEY,
  DAEMON_SERVICE_AUTOSTART_ENV_KEY,
  DAEMON_SERVICE_BUNDLE_ID_ENV_KEY,
  parseDaemonServiceBundleId,
  type DaemonServiceAutostartMode,
  type DaemonServiceManagedBy,
  type DaemonServiceMode,
  type DaemonServiceTargetMode,
} from './plan';

export type InstalledDaemonServiceEntry = Readonly<{
  serverId: string;
  activeServerId?: string | null;
  name: string;
  relayUrl?: string | null;
  installed: true;
  path: string;
  platform: 'darwin' | 'linux' | 'win32';
  mode?: DaemonServiceMode;
  happierHomeDir?: string | null;
  releaseChannel: PublicReleaseRingId;
  label: string;
  targetMode: DaemonServiceTargetMode;
  /** `desktop` when the definition carries the desktop marker; `null` (user-owned) otherwise. */
  managedBy?: DaemonServiceManagedBy | null;
}>;

type InstalledServicePathMatch = Readonly<{
  serverId: string;
  releaseChannel: PublicReleaseRingId;
  label: string;
  targetMode: DaemonServiceTargetMode;
}>;

function parseInstalledServicePath(platform: 'darwin' | 'linux' | 'win32', path: string): InstalledServicePathMatch | null {
  const fileName = platform === 'win32' ? win32Path.basename(path) : basename(path);
  const rawLegacyMatch =
    platform === 'linux'
      ? /^happier-daemon\.service$/i.test(fileName)
      : platform === 'darwin'
        ? /^com\.happier\.cli\.daemon\.plist$/i.test(fileName)
        : /^happier-daemon\.ps1$/i.test(fileName);
  if (rawLegacyMatch) {
    const label = platform === 'win32'
      ? `Happier\\${win32Path.basename(path, '.ps1')}`
      : platform === 'darwin'
        ? basename(path, '.plist')
        : basename(path, '.service');
    return {
      serverId: 'default',
      releaseChannel: 'stable',
      label,
      targetMode: 'default-following',
    };
  }

  const match =
    platform === 'linux'
      ? /^happier-daemon(?:\.(preview|dev))?\.(.+)\.service$/i.exec(fileName)
      : platform === 'darwin'
        ? /^com\.happier\.cli\.daemon(?:\.(preview|dev))?\.(.+)\.plist$/i.exec(fileName)
        : /^happier-daemon(?:\.(preview|dev))?\.(.+)\.ps1$/i.exec(fileName);
  if (!match) {
    return null;
  }
  const channelSegment = String(match[1] ?? '').trim().toLowerCase();
  const serverId = String(match[2] ?? '').trim();
  if (!serverId) {
    return null;
  }
  const releaseChannel = channelSegment === 'preview'
    ? 'preview'
    : channelSegment === 'dev'
      ? 'publicdev'
      : 'stable';
  const targetMode: DaemonServiceTargetMode = serverId === 'default' ? 'default-following' : 'pinned';
  const label = platform === 'win32'
    ? `Happier\\${win32Path.basename(path, '.ps1')}`
    : platform === 'darwin'
      ? basename(path, '.plist')
      : basename(path, '.service');
  return { serverId, releaseChannel, label, targetMode };
}

function normalizeParsedReleaseChannel(value: string | null): PublicReleaseRingId | null {
  if (value === 'preview') return 'preview';
  if (value === 'dev') return 'publicdev';
  if (value === 'stable') return 'stable';
  return null;
}

function isLegacyEnvHashServiceId(serverId: string): boolean {
  return /^env_[0-9a-f]+$/iu.test(String(serverId ?? '').trim());
}

function resolveDiscoveredServiceIdentity(params: Readonly<{
  parsed: InstalledServicePathMatch;
  activeServerId: string | null;
}>): string {
  if (
    params.parsed.targetMode === 'pinned'
    && params.activeServerId
    && isLegacyEnvHashServiceId(params.parsed.serverId)
  ) {
    return params.activeServerId;
  }
  return params.parsed.serverId;
}

function readInstalledServiceFile(path: string, requireReadable: boolean): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (cause) {
    if (requireReadable && !(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')) {
      throw Object.assign(new Error('Background service inventory could not be read', { cause }), {
        code: 'service_inventory_unavailable' as const,
      });
    }
    return null;
  }
}

type ParsedInstalledDaemonServiceDefinition =
  | ParsedLaunchdPlist
  | ParsedSystemdUnit
  | ParsedWindowsScheduledTaskWrapperPs1;

function parseInstalledDaemonServiceDefinition(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
  contents: string;
}>): ParsedInstalledDaemonServiceDefinition | null {
  if (params.platform === 'darwin') {
    return parseLaunchdPlist({ contents: params.contents, sourcePath: params.path });
  }
  if (params.platform === 'linux') {
    return parseSystemdUnit({ contents: params.contents, sourcePath: params.path });
  }
  return parseWindowsScheduledTaskWrapperPs1({ contents: params.contents, sourcePath: params.path });
}

function readInstalledDaemonServiceDefinition(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
  requireReadable?: boolean;
}>): ParsedInstalledDaemonServiceDefinition | null {
  const contents = readInstalledServiceFile(params.path, params.requireReadable === true);
  return contents === null
    ? null
    : parseInstalledDaemonServiceDefinition({ ...params, contents });
}

function readParsedServiceEnvValue(
  definition: ParsedInstalledDaemonServiceDefinition | null,
  key: string,
): string | null {
  const normalizedKey = String(key ?? '').trim();
  if (!normalizedKey) return null;
  const value = String(definition?.env[normalizedKey] ?? '').trim();
  return value || null;
}

function parseCsvFirstField(line: string): string | null {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return null;
  const match = /^"((?:[^"]|"")*)"/u.exec(trimmed);
  if (!match) return null;
  return match[1]?.replaceAll('""', '"').trim() || null;
}

function normalizeWindowsScheduledTaskName(taskName: string): string | null {
  const normalized = String(taskName ?? '')
    .trim()
    .replaceAll('/', '\\')
    .replace(/\\+/gu, '\\')
    .replace(/^\\+/u, '');
  return normalized || null;
}

function parseWindowsScheduledTaskWrapperPathFromXml(contents: string): string | null {
  const argumentsMatch = /<Arguments>([\s\S]*?)<\/Arguments>/iu.exec(String(contents ?? ''));
  if (!argumentsMatch) return null;
  const argumentsText = argumentsMatch[1]
    ?.replaceAll('&quot;', '"')
    ?.replaceAll('&apos;', '\'')
    ?.replaceAll('&amp;', '&')
    ?.trim();
  if (!argumentsText) return null;

  const quotedMatch = /-File\s+"([^"]+\.ps1)"/iu.exec(argumentsText);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }
  const bareMatch = /-File\s+([^\s]+\.ps1)/iu.exec(argumentsText);
  return bareMatch?.[1]?.trim() || null;
}

function parseWindowsScheduledTaskWrapperPathFromTaskToRun(taskToRunText: string): string | null {
  const taskToRun = String(taskToRunText ?? '').trim();
  if (!taskToRun) {
    return null;
  }
  const quotedMatch = /-File\s+"([^"]+\.ps1)"/iu.exec(taskToRun);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }
  const bareMatch = /-File\s+([^\s]+\.ps1)/iu.exec(taskToRun);
  return bareMatch?.[1]?.trim() || null;
}

function runWindowsSchtasksCommand(args: readonly string[]): ReturnType<typeof spawnBackgroundSync> {
  const timeoutMs = readPositiveIntEnv('HAPPIER_WINDOWS_SCHTASKS_TIMEOUT_MS', 15_000);
  return spawnBackgroundSync('schtasks', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
}

function readWindowsScheduledTaskWrapperPath(taskName: string): string | null {
  const normalizedTaskName = normalizeWindowsScheduledTaskName(taskName);
  if (!normalizedTaskName) return null;

  const result = runWindowsSchtasksCommand(['/Query', '/TN', normalizedTaskName, '/XML']);
  const xmlPath = !result.error && result.status === 0
    ? parseWindowsScheduledTaskWrapperPathFromXml(String(result.stdout ?? '')) : null;
  if (xmlPath) return xmlPath;
  const fallback = runWindowsSchtasksCommand(['/Query', '/TN', normalizedTaskName, '/FO', 'LIST', '/V']);
  const listPath = !fallback.error && fallback.status === 0
    ? parseWindowsScheduledTaskWrapperPathFromTaskToRun(String(fallback.stdout ?? '')) : null;
  if (listPath) return listPath;
  // Only a successful listing establishes disappearance; errors and localized diagnostics do not.
  if (!listWindowsScheduledTaskNames().some((name) => name.toLowerCase() === normalizedTaskName.toLowerCase())) return null;
  throw new Error(`Could not read its wrapper: ${String(fallback.stderr ?? result.stderr ?? '').trim() || 'task inspection failed'}`, { cause: fallback.error ?? result.error });
}

function deriveWindowsServiceHomeDirFromWrapperPath(wrapperPath: string | null): string | null {
  const normalizedPath = String(wrapperPath ?? '').trim();
  if (!normalizedPath) return null;
  const servicesSuffix = `${String.raw`\services`}`.toLowerCase();
  const normalizedLower = normalizedPath.toLowerCase();
  const index = normalizedLower.lastIndexOf(servicesSuffix);
  if (index <= 0) {
    return null;
  }
  return normalizedPath.slice(0, index);
}

function listWindowsScheduledTaskNames(): readonly string[] {
  const result = runWindowsSchtasksCommand(['/Query', '/FO', 'CSV', '/NH']);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not enumerate Happier scheduled tasks: ${String(result.stderr ?? '').trim() || `schtasks exited with status ${result.status}`}`);
  return String(result.stdout ?? '')
      .split(/\r?\n/u)
      .map((line) => parseCsvFirstField(line))
      .filter((taskName): taskName is string => Boolean(taskName))
      .map((taskName) => normalizeWindowsScheduledTaskName(taskName))
      .filter((taskName): taskName is string => Boolean(taskName))
      .filter((taskName) => taskName.toLowerCase().startsWith('happier\\happier-daemon'));
}

function listWindowsScheduledTaskWrapperPaths(): readonly string[] {
  return listWindowsScheduledTaskNames().map((taskName) => {
    try {
      return readWindowsScheduledTaskWrapperPath(taskName);
    } catch (cause) {
      throw new Error(`Could not inspect Happier scheduled task ${taskName}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }).filter((wrapperPath): wrapperPath is string => Boolean(wrapperPath));
}

function hasDaemonStartSyncCommand(definition: ParsedInstalledDaemonServiceDefinition | null): boolean {
  return /\bdaemon\b\s+\bstart-sync\b/iu.test(definition?.programArgs.join(' ') ?? '');
}

function hasLegacyManagedServiceEnv(definition: ParsedInstalledDaemonServiceDefinition | null): boolean {
  return readParsedServiceEnvValue(definition, 'HAPPIER_HOME_DIR') !== null
    || readParsedServiceEnvValue(definition, 'HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR') !== null;
}

function isValidInstalledDaemonServiceDefinition(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  expectedLabel: string;
  definition: ParsedInstalledDaemonServiceDefinition | null;
}>): boolean {
  const { definition } = params;
  if (!definition || !hasDaemonStartSyncCommand(definition)) {
    return false;
  }
  if (params.platform === 'darwin' && definition.label !== params.expectedLabel) {
    return false;
  }
  return readParsedServiceEnvValue(definition, 'HAPPIER_DAEMON_STARTUP_SOURCE') === 'background-service'
    || hasLegacyManagedServiceEnv(definition);
}

export function readInstalledDaemonServiceEnvValue(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
  key: string;
}>): string | null {
  return readParsedServiceEnvValue(readInstalledDaemonServiceDefinition(params), params.key);
}

/** The management marker a definition carries; anything but `desktop` reads as none (user-owned). */
export function readInstalledDaemonServiceManagedBy(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
}>): DaemonServiceManagedBy | null {
  const value = readInstalledDaemonServiceEnvValue({ ...params, key: DAEMON_SERVICE_MANAGED_BY_ENV_KEY });
  return value === 'desktop' ? 'desktop' : null;
}

/** Definition-owned metadata only: inherited install requests cannot change a rewrite. */
export function readInstalledDaemonServiceBundleId(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
}>): string | null {
  try {
    return parseDaemonServiceBundleId(readInstalledDaemonServiceEnvValue({ ...params, key: DAEMON_SERVICE_BUNDLE_ID_ENV_KEY }));
  } catch {
    return null;
  }
}

/** The declared trigger; real OS enablement is observed by readBackgroundServiceAutostartMode. */
export function readInstalledDaemonServiceAutostartMode(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
}>): DaemonServiceAutostartMode | null {
  const definition = readInstalledDaemonServiceDefinition(params);
  if (!definition) return null;
  if (definition.kind === 'launchd-plist') {
    return definition.runAtLoad || definition.keepAliveOnFailure ? 'at-login' : 'on-demand';
  }
  const value = readParsedServiceEnvValue(definition, DAEMON_SERVICE_AUTOSTART_ENV_KEY);
  return value === 'at-login' || value === 'on-demand' ? value : null;
}

/** Preserve optional defaults without adding a new marker to an unchanged legacy terminal install. */
export function readInstalledDaemonServiceInstallOptions(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
}>): Readonly<{ bundleId: string | null; autostart: DaemonServiceAutostartMode | undefined }> {
  const mode = readInstalledDaemonServiceAutostartMode(params);
  const recorded = readInstalledDaemonServiceEnvValue({ ...params, key: DAEMON_SERVICE_AUTOSTART_ENV_KEY });
  return {
    bundleId: readInstalledDaemonServiceBundleId(params),
    autostart: mode && (recorded || mode === 'on-demand') ? mode : undefined,
  };
}

export function isValidInstalledDaemonServiceFile(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  path: string;
  expectedLabel: string;
}>): boolean {
  return isValidInstalledDaemonServiceDefinition({
    platform: params.platform,
    expectedLabel: params.expectedLabel,
    definition: readInstalledDaemonServiceDefinition({ ...params, requireReadable: true }),
  });
}

function parseInstalledServiceMetadata(params: Readonly<{
  definition: ParsedInstalledDaemonServiceDefinition | null;
  initialReleaseChannel: PublicReleaseRingId;
  initialTargetMode: DaemonServiceTargetMode;
}>): Readonly<{
  activeServerId: string | null;
  happierHomeDir: string | null;
  relayUrl: string | null;
  releaseChannel: PublicReleaseRingId;
  targetMode: DaemonServiceTargetMode;
}> {
  if (!params.definition) {
    return {
      activeServerId: null,
      happierHomeDir: null,
      relayUrl: null,
      releaseChannel: params.initialReleaseChannel,
      targetMode: params.initialTargetMode,
    };
  }

  const readValue = (key: string) => readParsedServiceEnvValue(params.definition, key);

  const parsedTargetMode = readValue('HAPPIER_DAEMON_SERVICE_TARGET_MODE');
  const parsedServerId = readValue('HAPPIER_ACTIVE_SERVER_ID');
  const parsedHappierHomeDir = readValue('HAPPIER_HOME_DIR') ?? readValue('HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR');
  const parsedRelayUrl = readValue('HAPPIER_PUBLIC_SERVER_URL') ?? readValue('HAPPIER_SERVER_URL');
  const parsedReleaseChannel = normalizeParsedReleaseChannel(readValue('HAPPIER_PUBLIC_RELEASE_CHANNEL'));
  return {
    activeServerId: parsedServerId,
    happierHomeDir: parsedHappierHomeDir,
    relayUrl: parsedRelayUrl,
    releaseChannel: parsedReleaseChannel ?? params.initialReleaseChannel,
    targetMode: resolveDaemonServiceTargetMode(parsedTargetMode, params.initialTargetMode),
  };
}

export async function discoverInstalledDaemonServiceEntries(params: Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  userHomeDir: string;
  happierHomeDir: string;
  mode: DaemonServiceMode;
  serversById: Readonly<Record<string, unknown>>;
}>): Promise<readonly InstalledDaemonServiceEntry[]> {
  const servicesDir =
    params.platform === 'linux'
      ? params.mode === 'system'
        ? join('/etc', 'systemd', 'system')
        : join(params.userHomeDir, '.config', 'systemd', 'user')
      : params.platform === 'darwin'
        ? join(params.userHomeDir, 'Library', 'LaunchAgents')
        : join(params.happierHomeDir, 'services');

  let fileNames: string[] = [];
  try {
    fileNames = fs.readdirSync(servicesDir);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    if (params.platform !== 'win32') {
      return [];
    }
  }

  let scheduledTaskPaths: readonly string[] = [];
  try {
    if (params.platform === 'win32') scheduledTaskPaths = listWindowsScheduledTaskWrapperPaths();
  } catch (cause) {
    throw Object.assign(new Error(`Background service inventory could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }), { code: 'service_inventory_unavailable' as const });
  }
  const discoveredCandidates = [
    ...fileNames.map((fileName) => ({ path: join(servicesDir, fileName), source: 'file' as const })),
    ...scheduledTaskPaths.map((path) => ({ path, source: 'task' as const })),
  ].filter((candidate, index, allCandidates) => allCandidates.findIndex((other) => other.path === candidate.path) === index);

  return discoveredCandidates
    .flatMap(({ path, source }) => {
      const parsed = parseInstalledServicePath(params.platform, path);
      if (!parsed) {
        return [];
      }
      const definition = readInstalledDaemonServiceDefinition({
        platform: params.platform,
        path,
        requireReadable: true,
      });
      const definitionExists = isValidInstalledDaemonServiceDefinition({
        platform: params.platform,
        expectedLabel: parsed.label,
        definition,
      });
      if (!definitionExists && source !== 'task') {
        return [];
      }
      const metadata = parseInstalledServiceMetadata({
        definition,
        initialReleaseChannel: parsed.releaseChannel,
        initialTargetMode: parsed.targetMode,
      });
      const activeServerId = String(metadata.activeServerId ?? '').trim() || null;
      const serviceServerId = resolveDiscoveredServiceIdentity({ parsed, activeServerId });
      const profileServerId = activeServerId ?? serviceServerId;
      const profile = params.serversById[profileServerId];
      const profileRelayUrl = typeof profile === 'object'
        && profile
        && !Array.isArray(profile)
        && typeof (profile as { serverUrl?: unknown }).serverUrl === 'string'
          ? String((profile as { serverUrl: string }).serverUrl).trim() || null
          : null;
      const name = metadata.targetMode === 'default-following'
        ? 'Default automatic startup'
        : typeof profile === 'object' && profile && !Array.isArray(profile) && typeof (profile as { name?: unknown }).name === 'string'
          ? String((profile as { name: string }).name).trim() || profileServerId
          : profileServerId;
      return [{
        serverId: serviceServerId,
        ...(activeServerId ? { activeServerId } : {}),
        name,
        relayUrl: metadata.relayUrl ?? profileRelayUrl,
        installed: true as const,
        path,
        platform: params.platform,
        mode: params.mode,
        happierHomeDir: metadata.happierHomeDir ?? (
          params.platform === 'win32' && !definitionExists
            ? deriveWindowsServiceHomeDirFromWrapperPath(path)
            : null
        ),
        releaseChannel: metadata.releaseChannel,
        label: parsed.label,
        targetMode: metadata.targetMode,
        managedBy: readParsedServiceEnvValue(definition, DAEMON_SERVICE_MANAGED_BY_ENV_KEY) === 'desktop' ? 'desktop' as const : null,
      }];
    });
}
