import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { access, chmod, readFile, rename, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';

import {
  createManagedToolScratchDir,
  downloadGitHubReleaseAsset,
  promoteManagedCurrentInstall,
} from '@happier-dev/cli-common/agents';
import { extractReleasePayloadRootFromArchive } from '@happier-dev/cli-common/firstPartyRuntime';

import type { InstallableDependencyDescriptor } from '@happier-dev/protocol/installables';

import { configuration } from '@/configuration';
import { writeBytesAtomic } from '@/utils/fs/writeJsonAtomic';
import type { RuntimeInstallableAdapter } from '../registry';

export type PinnedArchiveAsset = Readonly<{
  archiveUrl: string;
  sha256: string;
  executableSubpath: string;
  args?: readonly string[];
}>;

export type PinnedArchiveInstallResult =
  | Readonly<{ ok: true; executablePath: string; version: string; integrityDigest: string }>
  | Readonly<{ ok: false; errorMessage: string }>;

function installRoot(installId: string): string {
  return join(configuration.happyHomeDir, 'tools', installId);
}

const MANAGED_VERSION_FILENAME = '.happier-managed-version';
const MANAGED_EXECUTABLE_DIGEST_FILENAME = '.happier-managed-executable-sha256';

async function computeFileSha256Hex(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function currentRoot(installId: string): string {
  return join(installRoot(installId), 'current');
}

function safeExecutablePath(root: string, executableSubpath: string): string | null {
  if (isAbsolute(executableSubpath)) return null;
  const candidate = join(root, executableSubpath);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    return null;
  }
  return candidate;
}

export async function resolveInstalledPinnedArchiveExecutable(params: Readonly<{
  installId: string;
  executableSubpath: string;
  version?: string;
  platform?: NodeJS.Platform | string;
}>): Promise<string | null> {
  if (params.version) {
    try {
      const installedVersion = await readFile(join(currentRoot(params.installId), MANAGED_VERSION_FILENAME), 'utf8');
      if (installedVersion !== params.version) return null;
    } catch {
      return null;
    }
  }
  const candidate = safeExecutablePath(currentRoot(params.installId), params.executableSubpath);
  if (!candidate) return null;
  try {
    await access(candidate, (params.platform ?? process.platform) === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
  } catch {
    return null;
  }
  try {
    const storedDigest = (await readFile(join(currentRoot(params.installId), MANAGED_EXECUTABLE_DIGEST_FILENAME), 'utf8')).trim();
    if (!/^sha256:[0-9a-f]{64}$/i.test(storedDigest)) return null;
    const actualDigest = `sha256:${await computeFileSha256Hex(candidate)}`;
    if (actualDigest.toLowerCase() !== storedDigest.toLowerCase()) return null;
    return candidate;
  } catch {
    return null;
  }
}

export async function installPinnedArchive(params: Readonly<{
  installId: string;
  version: string;
  asset: PinnedArchiveAsset;
  platform?: NodeJS.Platform | string;
}>): Promise<PinnedArchiveInstallResult> {
  const platform = params.platform ?? process.platform;
  const root = installRoot(params.installId);
  const scratchDir = await createManagedToolScratchDir({ installDir: root, prefix: params.installId });
  try {
    const archiveName = basename(new URL(params.asset.archiveUrl).pathname) || 'archive.zip';
    const archivePath = join(scratchDir, archiveName);
    const extractDir = join(scratchDir, 'extract');
    const candidateDir = join(scratchDir, 'candidate');
    await downloadGitHubReleaseAsset({
      url: params.asset.archiveUrl,
      destinationPath: archivePath,
      digest: `sha256:${params.asset.sha256}`,
      userAgent: 'happier-cli',
    });
    const payloadRoot = await extractReleasePayloadRootFromArchive({ archivePath, archiveName, extractDir });
    await rename(payloadRoot, candidateDir);
    const candidateExecutable = safeExecutablePath(candidateDir, params.asset.executableSubpath);
    if (!candidateExecutable) {
      return { ok: false, errorMessage: 'Pinned archive executable path is unsafe' };
    }
    try {
      await access(candidateExecutable, fsConstants.F_OK);
    } catch {
      return { ok: false, errorMessage: `Pinned archive executable missing at ${params.asset.executableSubpath}` };
    }
    if (platform !== 'win32') await chmod(candidateExecutable, 0o755);
    const executableDigest = `sha256:${await computeFileSha256Hex(candidateExecutable)}`;
    await writeBytesAtomic(join(candidateDir, MANAGED_VERSION_FILENAME), new TextEncoder().encode(params.version));
    await writeBytesAtomic(join(candidateDir, MANAGED_EXECUTABLE_DIGEST_FILENAME), new TextEncoder().encode(executableDigest));
    await promoteManagedCurrentInstall({
      installRoot: root,
      candidatePath: candidateDir,
      currentPath: currentRoot(params.installId),
    });
    const executablePath = safeExecutablePath(currentRoot(params.installId), params.asset.executableSubpath);
    if (!executablePath) return { ok: false, errorMessage: 'Pinned archive executable path is unsafe' };
    return { ok: true, executablePath, version: params.version, integrityDigest: `sha256:${params.asset.sha256}` };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : 'Pinned archive install failed' };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

export function createPinnedArchiveRuntimeInstallableAdapter(params: Readonly<{
  installId: `dep.${string}`;
  version: string;
  asset: PinnedArchiveAsset;
  platform?: NodeJS.Platform | string;
}>): RuntimeInstallableAdapter {
  const resolve = async () => await resolveInstalledPinnedArchiveExecutable({
    installId: params.installId,
    executableSubpath: params.asset.executableSubpath,
    version: params.version,
    platform: params.platform,
  });
  return Object.freeze({
    key: params.installId,
    capabilityId: params.installId,
    async detectCapabilityStatus() {
      const executablePath = await resolve();
      // One status shape for both readers: the managed-dependency host reads
      // `version`/`availableVersion`, the capability/UI installables path reads
      // the `installed` projection. A pinned artifact has no update discovery,
      // so the installed version is also the available version. This installer
      // writes no install log, and the installed executable is not one.
      return Object.freeze({
        installed: executablePath !== null,
        installedVersion: executablePath ? params.version : null,
        sourceKind: 'pinned_archive' as const,
        lastInstallLogPath: null,
        lastBackgroundUpdateCheckAtMs: null,
        ...(executablePath ? { version: params.version, availableVersion: params.version } : {}),
      });
    },
    async detectLaunchResolution() {
      const executablePath = await resolve();
      return Object.freeze({
        availability: executablePath
          ? Object.freeze({ ok: true as const })
          : Object.freeze({ ok: false as const, errorMessage: 'Pinned archive executable is not installed' }),
        canAutoInstall: true,
        canBackgroundAutoUpdate: false,
      });
    },
    async resolveLaunchCommand() {
      const command = await resolve();
      return command
        ? Object.freeze({ ok: true as const, command, args: Object.freeze([...(params.asset.args ?? [])]), source: 'managed' as const })
        : Object.freeze({ ok: false as const, errorMessage: 'Pinned archive executable is not installed', canAutoInstall: true });
    },
    async installOrUpgrade() {
      const result = await installPinnedArchive(params);
      return result.ok
        ? Object.freeze({ ok: true as const, logPath: null })
        : Object.freeze({ ok: false as const, errorMessage: result.errorMessage, logPath: null });
    },
    async removeManagedInstall() {
      await rm(installRoot(params.installId), { recursive: true, force: true });
    },
    async runBackgroundAutoUpdateCheck() {},
  });
}

type PinnedArchiveSource = Extract<InstallableDependencyDescriptor['source'], { kind: 'pinned_archive' }>;

/**
 * Resolves the pinned-archive adapter for a projected installables descriptor,
 * so capability status/install and the launch-time managed-dependency host
 * share this one installer. Returns `null` when the pinned source publishes no
 * artifact for the running host, which is an unsupported platform rather than
 * an install failure.
 */
export function getPinnedArchiveRuntimeInstallableAdapter(
  descriptor: InstallableDependencyDescriptor,
  host: Readonly<{ platform?: NodeJS.Platform; architecture?: string }> = {},
): RuntimeInstallableAdapter | null {
  if (descriptor.source.kind !== 'pinned_archive') return null;
  const platform = host.platform ?? process.platform;
  const architecture = host.architecture ?? process.arch;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') return null;
  if (architecture !== 'arm64' && architecture !== 'x64') return null;
  const platformKey = `${platform}-${architecture}` as keyof PinnedArchiveSource['assetsByPlatform'];
  const asset = descriptor.source.assetsByPlatform[platformKey];
  if (!asset) return null;
  return createPinnedArchiveRuntimeInstallableAdapter({
    installId: descriptor.capabilityId,
    version: descriptor.source.version,
    asset,
    platform,
  });
}
