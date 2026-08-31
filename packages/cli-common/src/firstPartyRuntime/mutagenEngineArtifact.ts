import {
  createHash,
} from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  join,
  relative,
  resolve,
  win32,
} from 'node:path';

/**
 * The Mutagen engine is deliberately pinned independently from the Happier
 * release rings.  A rolling `mutagen-stable` tag is not a valid engine input:
 * manager and agent must come from one immutable fork release.
 */
export const MUTAGEN_ENGINE_FORK_REMOTE = 'https://github.com/happier-dev/mutagen.git';
export const MUTAGEN_ENGINE_FORK_BRANCH = 'happier/external-stream-v1';
/** Immutable commit on which the current uncommitted fork implementation is based. */
export const MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT = 'f5ed5c91fa6c934f5678393c56d00362d6443a1d';
/** Filled only after the implementation is committed; release preparation blocks while null. */
export const MUTAGEN_ENGINE_FORK_RELEASE_COMMIT: string | null = null;
export const MUTAGEN_ENGINE_TRANSPORT_SPIKE_COMMIT = 'cd8069cf8b945dfa0d0f47d8685322c6f1e16e44';
export const MUTAGEN_ENGINE_UPSTREAM_TAG = 'v0.18.1';
export const MUTAGEN_ENGINE_UPSTREAM_COMMIT = 'a225ae50aee3d7ebb59139203cb84e8a6a3ff4bf';
export const MUTAGEN_ENGINE_GO_VERSION = '1.22.12';
export const MUTAGEN_ENGINE_PROTOCOL_EPOCH = 'external-stream-v1';
export const MUTAGEN_ENGINE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const MUTAGEN_ENGINE_ARTIFACT_FORMAT = 'happier-mutagen-engine';

/** SHA-256 values published by the Go distribution index for Go 1.22.12. */
export const MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256 = Object.freeze({
  'darwin-arm64': '416c35218edb9d20990b5d8fc87be655d8b39926f15524ea35c66ee70273050d',
  'darwin-amd64': 'e7bbe07e96f0bd3df04225090fe1e7852ed33af37c43a23e16edbbb3b90a5b7c',
  'linux-amd64': '4fa4f869b0f7fc6bb1eb2660e74657fbf04cdd290b5aef905585c86051b34d43',
  'linux-arm64': 'fd017e647ec28525e86ae8203236e0653242722a7436929b1f775744e26278e7',
  'windows-amd64': '2ceda04074eac51f4b0b85a9fcca38bcd49daee24bed9ea1f29958a8e22673a6',
} as const);

export const MUTAGEN_ENGINE_SUPPORTED_TARGETS = [
  'darwin-arm64',
  'darwin-amd64',
  'linux-amd64',
  'linux-arm64',
  'windows-amd64',
] as const;

export type MutagenEngineArtifactTarget = (typeof MUTAGEN_ENGINE_SUPPORTED_TARGETS)[number];
export type MutagenEngineWatcher = 'fsevents' | 'inotify' | 'native' | 'polling';

export type MutagenEngineArtifactErrorCode =
  | 'mutagen_engine_artifact_untrusted'
  | 'mutagen_engine_artifact_incomplete'
  | 'mutagen_engine_unsupported_platform'
  | 'mutagen_engine_data_dir_conflict';

export class MutagenEngineArtifactError extends Error {
  readonly code: MutagenEngineArtifactErrorCode;

  constructor(code: MutagenEngineArtifactErrorCode, message: string) {
    super(message);
    this.name = 'MutagenEngineArtifactError';
    this.code = code;
  }
}

export interface MutagenEngineArtifactManifest {
  readonly format: typeof MUTAGEN_ENGINE_ARTIFACT_FORMAT;
  readonly schemaVersion: typeof MUTAGEN_ENGINE_ARTIFACT_SCHEMA_VERSION;
  readonly component: 'mutagen-engine';
  readonly engineVersion: string;
  /** Exact immutable commit whose bytes produced the manager/agent pair. */
  readonly forkCommit: string;
  readonly forkBranch: typeof MUTAGEN_ENGINE_FORK_BRANCH;
  readonly transportSpikeCommit: typeof MUTAGEN_ENGINE_TRANSPORT_SPIKE_COMMIT;
  readonly upstreamTag: typeof MUTAGEN_ENGINE_UPSTREAM_TAG;
  readonly upstreamCommit: typeof MUTAGEN_ENGINE_UPSTREAM_COMMIT;
  readonly toolchain: Readonly<{
    go: typeof MUTAGEN_ENGINE_GO_VERSION;
    goChecksum: string;
    goDistributionSha256?: string;
  }>;
  readonly protocolEpoch: typeof MUTAGEN_ENGINE_PROTOCOL_EPOCH;
  readonly targetTriple: MutagenEngineArtifactTarget;
  readonly supportedTargets?: readonly MutagenEngineArtifactTarget[];
  readonly managerPath: 'bin/happier-mutagen';
  readonly agentPath: 'bin/happier-mutagen-agent';
  readonly licensePolicy: 'mit-only';
  readonly ssplEnabled: false;
  readonly buildTags: readonly string[];
  readonly cgoEnabled: boolean;
  readonly watcher: MutagenEngineWatcher;
  readonly protocol?: string;
  readonly managerSha256: string;
  readonly agentSha256: string;
  readonly releaseTag?: string;
}

export interface MutagenEngineArtifactPaths {
  readonly managerPath: string;
  readonly agentPath: string;
  readonly mutagenLicensePath: string;
  readonly thirdPartyNoticesPath: string;
  readonly manifestPath: string;
  readonly checksumsPath: string;
}

export interface MutagenEngineDataLayout {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly brokerDir: string;
  readonly stagingDir: string;
}

export interface MutagenEngineReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export interface MutagenEngineReleaseAssetBundle {
  readonly version: string;
  readonly targetTriple: MutagenEngineArtifactTarget;
  readonly archive: MutagenEngineReleaseAsset;
  readonly checksums: MutagenEngineReleaseAsset;
  readonly checksumsSig: MutagenEngineReleaseAsset;
}

const ENGINE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const RELATIVE_ARTIFACT_PATHS = new Set([
  'bin/happier-mutagen',
  'bin/happier-mutagen-agent',
]);

/** Resolve the only release-tag shape accepted for a Mutagen engine. */
export function resolveMutagenEngineReleaseTag(engineVersion: string): string {
  const version = String(engineVersion ?? '').trim();
  if (!ENGINE_VERSION_PATTERN.test(version)) {
    throw new MutagenEngineArtifactError(
      'mutagen_engine_artifact_untrusted',
      `Mutagen engine version must be an immutable semantic version, received '${version || '<empty>'}'.`,
    );
  }
  return `mutagen-v${version}`;
}

/**
 * Resolve manager/agent archive assets from one immutable fork release.  The
 * target triple is part of the filename so an x64 host cannot accidentally
 * consume a similarly named rolling CLI archive.
 */
export function resolveMutagenEngineReleaseAssetBundle(params: Readonly<{
  assets: unknown;
  engineVersion: string;
  targetTriple: MutagenEngineArtifactTarget;
  preferZipOnWindows?: boolean;
}>): MutagenEngineReleaseAssetBundle {
  const version = String(params.engineVersion ?? '').trim();
  const targetTriple = params.targetTriple;
  resolveMutagenEngineReleaseTag(version);
  if (!MUTAGEN_ENGINE_SUPPORTED_TARGETS.includes(targetTriple)) {
    throw new MutagenEngineArtifactError(
      'mutagen_engine_unsupported_platform',
      `Unsupported Mutagen engine target triple: ${String(targetTriple)}`,
    );
  }
  const assets = Array.isArray(params.assets) ? params.assets : [];
  const byName = new Map<string, MutagenEngineReleaseAsset>();
  for (const value of assets) {
    if (value == null || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const url = typeof record.browser_download_url === 'string'
      ? record.browser_download_url.trim()
      : typeof record.url === 'string' ? record.url.trim() : '';
    if (name && url) byName.set(name, { name, url });
  }
  const base = `happier-mutagen-v${version}-${targetTriple}`;
  const archiveNames = targetTriple.startsWith('windows-') && params.preferZipOnWindows !== false
    ? [`${base}.zip`, `${base}.tar.gz`]
    : [`${base}.tar.gz`, `${base}.zip`];
  const archive = archiveNames.map((name) => byName.get(name)).find((entry): entry is MutagenEngineReleaseAsset => entry != null);
  const checksumsName = `checksums-happier-mutagen-v${version}.txt`;
  const checksums = byName.get(checksumsName);
  const checksumsSig = byName.get(`${checksumsName}.minisig`);
  if (!archive || !checksums || !checksumsSig) {
    throw new MutagenEngineArtifactError(
      'mutagen_engine_artifact_untrusted',
      `Mutagen engine release ${resolveMutagenEngineReleaseTag(version)} is missing the exact ${targetTriple} archive, checksums, or signature.`,
    );
  }
  return { version, targetTriple, archive, checksums, checksumsSig };
}

/** Map Node host values to the fixed manager/agent release matrix. */
export function resolveMutagenEngineArtifactTarget(params: Readonly<{
  platform?: string;
  arch?: string;
}> = {}): MutagenEngineArtifactTarget {
  const platform = String(params.platform ?? process.platform).trim().toLowerCase();
  const arch = String(params.arch ?? process.arch).trim().toLowerCase();
  const normalizedPlatform = platform === 'mac' || platform === 'macos'
    ? 'darwin'
    : platform === 'windows'
      ? 'win32'
      : platform;
  const normalizedArch = arch === 'amd64' || arch === 'x86_64'
    ? 'x64'
    : arch === 'aarch64'
      ? 'arm64'
      : arch;
  const target = normalizedPlatform === 'win32'
    ? normalizedArch === 'x64' ? 'windows-amd64' : null
    : normalizedPlatform === 'darwin' || normalizedPlatform === 'linux'
      ? normalizedArch === 'x64'
        ? `${normalizedPlatform}-amd64`
        : normalizedArch === 'arm64'
          ? `${normalizedPlatform}-arm64`
          : null
      : null;
  if (!target || !MUTAGEN_ENGINE_SUPPORTED_TARGETS.includes(target as MutagenEngineArtifactTarget)) {
    throw new MutagenEngineArtifactError(
      'mutagen_engine_unsupported_platform',
      `Unsupported platform for Mutagen engine target: ${platform || '<empty>'}/${arch || '<empty>'}.`,
    );
  }
  return target as MutagenEngineArtifactTarget;
}

export function resolveMutagenEngineArtifactPaths(payloadRoot: string): MutagenEngineArtifactPaths {
  const root = String(payloadRoot ?? '').trim();
  if (!root) {
    throw new MutagenEngineArtifactError(
      'mutagen_engine_artifact_incomplete',
      'Mutagen engine payload root is required.',
    );
  }
  return {
    managerPath: join(root, 'bin', 'happier-mutagen'),
    agentPath: join(root, 'bin', 'happier-mutagen-agent'),
    mutagenLicensePath: join(root, 'licenses', 'MUTAGEN-LICENSE'),
    thirdPartyNoticesPath: join(root, 'licenses', 'THIRD-PARTY-NOTICES'),
    manifestPath: join(root, '.happier-mutagen-engine.json'),
    checksumsPath: join(root, 'checksums.txt'),
  };
}

/**
 * Validate the signed metadata embedded in a manager/agent payload.  This is
 * the canonical supply-chain owner used by both install and build tooling.
 */
export function assertMutagenEngineArtifactManifest(
  value: unknown,
  options: Readonly<{ trustedForkReleaseCommit?: string | null }> = {},
): MutagenEngineArtifactManifest {
  const record = asRecord(value, 'Mutagen engine manifest');
  assertOnlyKeys(record, new Set([
    'format', 'schemaVersion', 'component', 'engineVersion', 'forkCommit', 'forkBranch',
    'transportSpikeCommit', 'upstreamTag', 'upstreamCommit', 'toolchain', 'protocolEpoch',
    'targetTriple', 'supportedTargets', 'managerPath', 'agentPath', 'licensePolicy',
    'ssplEnabled', 'buildTags', 'cgoEnabled', 'watcher', 'protocol', 'managerSha256',
    'agentSha256', 'releaseTag',
  ]), 'manifest');
  const format = readOptionalString(record, 'format') ?? MUTAGEN_ENGINE_ARTIFACT_FORMAT;
  if (format !== MUTAGEN_ENGINE_ARTIFACT_FORMAT) {
    rejectManifest(`manifest format must be ${MUTAGEN_ENGINE_ARTIFACT_FORMAT}`);
  }
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== MUTAGEN_ENGINE_ARTIFACT_SCHEMA_VERSION) {
    rejectManifest(`unsupported Mutagen engine manifest schema version: ${String(schemaVersion)}`);
  }
  if (record.component !== 'mutagen-engine') rejectManifest('manifest component must be mutagen-engine');

  const engineVersion = readRequiredString(record, 'engineVersion');
  if (!ENGINE_VERSION_PATTERN.test(engineVersion)) rejectManifest('manifest engineVersion is invalid');
  const forkCommit = readRequiredString(record, 'forkCommit');
  const forkBranch = readOptionalString(record, 'forkBranch') ?? MUTAGEN_ENGINE_FORK_BRANCH;
  if (forkBranch !== MUTAGEN_ENGINE_FORK_BRANCH) rejectManifest('manifest fork branch is not approved');
  const transportSpikeCommit = readOptionalString(record, 'transportSpikeCommit') ?? MUTAGEN_ENGINE_TRANSPORT_SPIKE_COMMIT;
  if (transportSpikeCommit !== MUTAGEN_ENGINE_TRANSPORT_SPIKE_COMMIT) {
    rejectManifest('manifest transport spike commit is not approved');
  }
  const upstreamTag = readRequiredString(record, 'upstreamTag');
  if (upstreamTag !== MUTAGEN_ENGINE_UPSTREAM_TAG) rejectManifest('manifest upstream tag is not approved');
  const upstreamCommit = readRequiredString(record, 'upstreamCommit');
  if (upstreamCommit !== MUTAGEN_ENGINE_UPSTREAM_COMMIT) rejectManifest('manifest upstream commit is not approved');
  if (!COMMIT_PATTERN.test(forkCommit) || !COMMIT_PATTERN.test(upstreamCommit) || !COMMIT_PATTERN.test(transportSpikeCommit)) {
    rejectManifest('manifest commit values must be full 40-character SHA-1 values');
  }

  const toolchain = asRecord(record.toolchain, 'manifest toolchain');
  assertOnlyKeys(toolchain, new Set(['go', 'goChecksum', 'checksum', 'goDistributionSha256']), 'manifest toolchain');
  const go = readRequiredString(toolchain, 'go');
  if (go !== MUTAGEN_ENGINE_GO_VERSION) rejectManifest(`manifest Go toolchain must be ${MUTAGEN_ENGINE_GO_VERSION}`);
  const targetTriple = readRequiredString(record, 'targetTriple') as MutagenEngineArtifactTarget;
  if (!MUTAGEN_ENGINE_SUPPORTED_TARGETS.includes(targetTriple)) rejectManifest('manifest target triple is unsupported');
  const supportedTargetsValue = record.supportedTargets;
  const supportedTargets = supportedTargetsValue === undefined
    ? undefined
    : readStringArray(record, 'supportedTargets') as MutagenEngineArtifactTarget[];
  if (supportedTargets != null
    && (supportedTargets.length !== MUTAGEN_ENGINE_SUPPORTED_TARGETS.length
      || supportedTargets.some((target, index) => target !== MUTAGEN_ENGINE_SUPPORTED_TARGETS[index]))) {
    rejectManifest('manifest supported target matrix is not approved');
  }
  const goChecksum = readOptionalString(toolchain, 'goChecksum')
    ?? readOptionalString(toolchain, 'checksum')
    ?? readOptionalString(toolchain, 'goDistributionSha256');
  if (!goChecksum) rejectManifest('manifest Go distribution checksum is required');
  if (goChecksum != null) {
    if (!SHA256_PATTERN.test(goChecksum)) rejectManifest('manifest Go checksum must be SHA-256');
    if (goChecksum !== MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256[targetTriple]) {
      rejectManifest(`manifest Go checksum does not match Go ${MUTAGEN_ENGINE_GO_VERSION} for ${targetTriple}`);
    }
  }

  const protocolEpoch = readRequiredString(record, 'protocolEpoch');
  if (protocolEpoch !== MUTAGEN_ENGINE_PROTOCOL_EPOCH) rejectManifest('manifest protocol epoch is not approved');
  const protocol = readOptionalString(record, 'protocol');
  if (protocol != null && (!/^external:\/\/[^/?#]+$/u.test(protocol) || protocol.length > 256)) {
    rejectManifest('manifest protocol must be an opaque external:// endpoint without path, query, or fragment');
  }

  const managerPath = readRequiredString(record, 'managerPath');
  const agentPath = readRequiredString(record, 'agentPath');
  if (managerPath !== 'bin/happier-mutagen' || agentPath !== 'bin/happier-mutagen-agent') {
    rejectManifest('manifest must contain the manager and agent at the canonical bin paths');
  }
  if (!RELATIVE_ARTIFACT_PATHS.has(managerPath) || !RELATIVE_ARTIFACT_PATHS.has(agentPath)) {
    rejectManifest('manifest executable paths must be relative and canonical');
  }

  if (record.licensePolicy !== 'mit-only') rejectManifest('Mutagen engine license policy must be mit-only');
  if (record.ssplEnabled !== false) rejectManifest('SSPL-enabled Mutagen artifacts are not accepted');
  const buildTags = readStringArray(record, 'buildTags');
  if (buildTags.some((tag) => /sspl/i.test(tag))) rejectManifest('SSPL build tags are not accepted');
  const cgoEnabled = readBoolean(record, 'cgoEnabled');
  const watcher = readRequiredString(record, 'watcher') as MutagenEngineWatcher;
  if (!['fsevents', 'inotify', 'native', 'polling'].includes(watcher)) rejectManifest('manifest watcher policy is invalid');
  if (targetTriple.startsWith('darwin-') && (!cgoEnabled || watcher !== 'fsevents')) {
    rejectManifest('macOS Mutagen artifacts must use cgo-enabled FSEvents builds');
  }
  const releaseTag = readOptionalString(record, 'releaseTag');
  if (releaseTag != null && releaseTag !== resolveMutagenEngineReleaseTag(engineVersion)) {
    rejectManifest('manifest release tag does not match the immutable engine version');
  }
  const managerSha256 = readRequiredString(record, 'managerSha256');
  const agentSha256 = readRequiredString(record, 'agentSha256');
  if (!SHA256_PATTERN.test(managerSha256)) rejectManifest('manifest managerSha256 must be SHA-256');
  if (!SHA256_PATTERN.test(agentSha256)) rejectManifest('manifest agentSha256 must be SHA-256');

  const trustedForkReleaseCommit = options.trustedForkReleaseCommit === undefined
    ? MUTAGEN_ENGINE_FORK_RELEASE_COMMIT
    : options.trustedForkReleaseCommit;
  if (trustedForkReleaseCommit == null) {
    rejectManifest('mutagen_fork_release_commit_required: the current fork implementation has no immutable release commit');
  }
  if (!COMMIT_PATTERN.test(trustedForkReleaseCommit)) {
    rejectManifest('trusted fork release commit must be a full 40-character SHA-1 value');
  }
  if (forkCommit !== trustedForkReleaseCommit) {
    rejectManifest(`manifest fork commit must be the exact release commit ${trustedForkReleaseCommit}`);
  }

  return Object.freeze({
    format: MUTAGEN_ENGINE_ARTIFACT_FORMAT,
    schemaVersion: MUTAGEN_ENGINE_ARTIFACT_SCHEMA_VERSION,
    component: 'mutagen-engine',
    engineVersion,
    forkCommit,
    forkBranch: MUTAGEN_ENGINE_FORK_BRANCH,
    transportSpikeCommit: MUTAGEN_ENGINE_TRANSPORT_SPIKE_COMMIT,
    upstreamTag: MUTAGEN_ENGINE_UPSTREAM_TAG,
    upstreamCommit: MUTAGEN_ENGINE_UPSTREAM_COMMIT,
    toolchain: Object.freeze({
      go: MUTAGEN_ENGINE_GO_VERSION,
      goChecksum,
    }),
    protocolEpoch: MUTAGEN_ENGINE_PROTOCOL_EPOCH,
    targetTriple,
    ...(supportedTargets ? { supportedTargets: Object.freeze([...supportedTargets]) } : {}),
    managerPath: 'bin/happier-mutagen',
    agentPath: 'bin/happier-mutagen-agent',
    licensePolicy: 'mit-only',
    ssplEnabled: false,
    buildTags: Object.freeze([...buildTags]),
    cgoEnabled,
    watcher,
    ...(protocol ? { protocol } : {}),
    managerSha256,
    agentSha256,
    ...(releaseTag ? { releaseTag } : {}),
  });
}

/** Validate the complete extracted payload before it enters managed install. */
export function assertMutagenEngineArtifactPayload(params: Readonly<{
  payloadRoot: string;
  targetTriple?: MutagenEngineArtifactTarget;
  engineVersion?: string;
  /** Repository build tooling may supply its already-validated release policy; runtime callers omit this. */
  trustedForkReleaseCommit?: string | null;
}>): MutagenEngineArtifactManifest {
  const root = String(params.payloadRoot ?? '').trim();
  if (!root) rejectPayload('Mutagen engine payload root is required');
  const paths = resolveMutagenEngineArtifactPaths(root);
  for (const [label, path] of [
    ['manager binary', paths.managerPath],
    ['agent binary', paths.agentPath],
    ['Mutagen license', paths.mutagenLicensePath],
    ['third-party notices', paths.thirdPartyNoticesPath],
    ['checksums', paths.checksumsPath],
    ['artifact manifest', paths.manifestPath],
  ] as const) {
    assertRegularFile(path, label);
  }
  if (process.platform !== 'win32' || params.targetTriple !== 'windows-amd64') {
    assertExecutable(paths.managerPath, 'manager binary');
    assertExecutable(paths.agentPath, 'agent binary');
  }
  const license = readFileSync(paths.mutagenLicensePath, 'utf8');
  if (!license.trim() || /SSPL/i.test(license)) rejectPayload('Mutagen license closure is missing or contains SSPL text');
  if (!readFileSync(paths.thirdPartyNoticesPath, 'utf8').trim()) rejectPayload('third-party notice closure is empty');
  const checksums = parseMutagenEngineChecksums(readFileSync(paths.checksumsPath, 'utf8'));

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(paths.manifestPath, 'utf8')) as unknown;
  } catch (error) {
    rejectPayload(`artifact manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = assertMutagenEngineArtifactManifest(
    rawManifest,
    params.trustedForkReleaseCommit === undefined
      ? {}
      : { trustedForkReleaseCommit: params.trustedForkReleaseCommit },
  );
  if (params.targetTriple != null && manifest.targetTriple !== params.targetTriple) {
    rejectPayload(`artifact target triple ${manifest.targetTriple} does not match requested ${params.targetTriple}`);
  }
  if (params.engineVersion != null && manifest.engineVersion !== params.engineVersion) {
    rejectPayload(`artifact engine version ${manifest.engineVersion} does not match requested ${params.engineVersion}`);
  }
  if (checksums.get('bin/happier-mutagen') !== manifest.managerSha256
    || checksums.get('bin/happier-mutagen-agent') !== manifest.agentSha256) {
    rejectPayload('checksums.txt does not match the signed artifact manifest');
  }
  if (sha256File(paths.managerPath) !== manifest.managerSha256) {
    rejectPayload('manager binary checksum does not match the artifact manifest');
  }
  if (sha256File(paths.agentPath) !== manifest.agentSha256) {
    rejectPayload('agent binary checksum does not match the artifact manifest');
  }
  assertNoForbiddenEntries(root);
  return manifest;
}

/** Resolve isolated manager state; stack dev-target data can never overlap it. */
export function resolveMutagenEngineDataLayout(params: Readonly<{
  daemonDataRoot: string;
  stackDevTargetMutagenDataDir?: string | null;
}>): MutagenEngineDataLayout {
  const daemonDataRoot = resolvePathLike(params.daemonDataRoot);
  if (!String(params.daemonDataRoot ?? '').trim()) {
    throw new MutagenEngineArtifactError('mutagen_engine_data_dir_conflict', 'daemon data root is required');
  }
  const pathModule = isWindowsPathLike(daemonDataRoot) ? win32 : null;
  const rootDir = (pathModule ?? { resolve }).resolve(daemonDataRoot, 'workspace-sync', 'mutagen');
  const dataDir = (pathModule ?? { resolve }).resolve(rootDir, 'data');
  const brokerDir = (pathModule ?? { resolve }).resolve(rootDir, 'broker');
  const stagingDir = (pathModule ?? { resolve }).resolve(rootDir, 'staging');
  const stackData = String(params.stackDevTargetMutagenDataDir ?? process.env.MUTAGEN_DATA_DIRECTORY ?? '').trim();
  if (stackData) {
    const normalizedStackData = resolvePathLike(stackData);
    if ([rootDir, dataDir, brokerDir, stagingDir].some((candidate) => pathsOverlap(candidate, normalizedStackData))) {
      throw new MutagenEngineArtifactError(
        'mutagen_engine_data_dir_conflict',
        `Managed Mutagen data must be isolated from the stack dev-target MUTAGEN_DATA_DIRECTORY (${normalizedStackData}).`,
      );
    }
  }
  return Object.freeze({ rootDir, dataDir, brokerDir, stagingDir });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    rejectManifest(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) rejectManifest(`${label} contains unknown field(s): ${unknown.join(', ')}`);
}

function parseMutagenEngineChecksums(value: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const lines = value.trim().split(/\r?\n/u);
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(bin\/happier-mutagen(?:-agent)?)$/u.exec(line);
    if (!match || result.has(match[2])) rejectPayload('checksums.txt has malformed or duplicate entries');
    result.set(match[2], match[1]);
  }
  if (result.size !== 2 || !result.has('bin/happier-mutagen') || !result.has('bin/happier-mutagen-agent')) {
    rejectPayload('checksums.txt must contain exactly the manager and agent checksums');
  }
  return result;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);
  if (!value) rejectManifest(`manifest ${key} is required`);
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== 'boolean') rejectManifest(`manifest ${key} must be boolean`);
  return record[key] as boolean;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    rejectManifest(`manifest ${key} must be a string array`);
  }
  return (value as string[]).map((entry) => entry.trim());
}

function rejectManifest(message: string): never {
  throw new MutagenEngineArtifactError('mutagen_engine_artifact_untrusted', message);
}

function rejectPayload(message: string): never {
  throw new MutagenEngineArtifactError('mutagen_engine_artifact_incomplete', message);
}

function assertRegularFile(path: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    rejectPayload(`${label} is missing: ${path}`);
  }
  if (!stats.isFile()) rejectPayload(`${label} must be a regular file: ${path}`);
}

function assertExecutable(path: string, label: string): void {
  let mode = 0;
  try {
    mode = lstatSync(path).mode;
  } catch {
    rejectPayload(`${label} is missing: ${path}`);
  }
  if ((mode & 0o111) === 0) rejectPayload(`${label} is not executable: ${path}`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertNoForbiddenEntries(root: string): void {
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (/sspl/i.test(entry.name) || entry.name === 'LICENSE-SSPL') {
        rejectPayload(`SSPL payload entry is forbidden: ${relative(root, path)}`);
      }
      if (entry.isDirectory()) visit(path);
    }
  };
  visit(root);
}

function isWindowsPathLike(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('\\\\');
}

function resolvePathLike(value: string): string {
  const raw = String(value ?? '').trim();
  return isWindowsPathLike(raw) ? win32.resolve(raw) : resolve(raw);
}

function pathsOverlap(left: string, right: string): boolean {
  const leftCanonical = canonicalPath(left);
  const rightCanonical = canonicalPath(right);
  return leftCanonical === rightCanonical
    || leftCanonical.startsWith(`${rightCanonical}/`)
    || rightCanonical.startsWith(`${leftCanonical}/`);
}

function canonicalPath(path: string): string {
  const resolved = resolvePathLike(path).replaceAll('\\', '/').replace(/\/+$/u, '');
  return isWindowsPathLike(resolved) ? resolved.toLowerCase() : resolved;
}
