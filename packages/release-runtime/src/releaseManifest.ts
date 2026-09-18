import { RELEASE_PRODUCTS, type ReleaseProduct } from './releaseProducts.js';

export type ReleaseManifestRecordV1 = Readonly<{
  schemaVersion: 'v1'; product: ReleaseProduct; channel: string; version: string;
  os: 'linux' | 'darwin' | 'windows'; arch: 'x64' | 'arm64'; url: string; sha256: string;
  signature: string; publishedAt: string; minSupportedVersion: string | null;
  rolloutPercent: number; critical: boolean; notesUrl: string | null;
  build: Readonly<{ commitSha: string | null; workflowRunId: string | null }>;
  publication: Readonly<{ workflowRunId: string | null }>;
  sizeBytes?: number;
  entries?: readonly Readonly<{ path: string; kind: 'file' | 'directory' | 'symlink'; sizeBytes: number; mode: number; linkTarget?: string }>[];
}>;

export type ReleaseManifestV1 = Readonly<{
  schemaVersion: 'v1'; product: ReleaseProduct; channel: string; version: string;
  publishedAt: string; records: readonly ReleaseManifestRecordV1[];
}>;

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[release manifest] ${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], name: string, optionalKeys: readonly string[] = []) {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`[release manifest] unknown field ${name}.${unknown}`);
  const optional = new Set(optionalKeys);
  const missing = keys.find((key) => !optional.has(key) && !(key in value));
  if (missing) throw new Error(`[release manifest] missing field ${name}.${missing}`);
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`[release manifest] ${name} must be non-empty text`);
  return value;
}

function nullableText(value: unknown, name: string): string | null {
  return value === null ? null : text(value, name);
}

const RECORD_KEYS = ['schemaVersion', 'product', 'channel', 'version', 'os', 'arch', 'url', 'sha256', 'signature', 'publishedAt', 'minSupportedVersion', 'rolloutPercent', 'critical', 'notesUrl', 'build', 'publication', 'sizeBytes', 'entries'] as const;

function safeInteger(value: unknown, name: string, positive = false): number {
  if (!Number.isSafeInteger(value) || (positive ? Number(value) <= 0 : Number(value) < 0)) throw new Error(`[release manifest] invalid ${name}`);
  return Number(value);
}

export function parseReleaseManifestV1(input: unknown): ReleaseManifestV1 {
  const value = object(input, 'manifest');
  exact(value, ['schemaVersion', 'product', 'channel', 'version', 'publishedAt', 'records'], 'manifest');
  if (value.schemaVersion !== 'v1' || !RELEASE_PRODUCTS.includes(value.product as ReleaseProduct)) throw new Error('[release manifest] unsupported identity');
  const product = value.product as ReleaseProduct;
  const channel = text(value.channel, 'manifest.channel');
  const version = text(value.version, 'manifest.version');
  const publishedAt = text(value.publishedAt, 'manifest.publishedAt');
  if (!Array.isArray(value.records)) throw new Error('[release manifest] records must be an array');
  const records = value.records.map((entry, index): ReleaseManifestRecordV1 => {
    const row = object(entry, `records[${index}]`);
    exact(row, RECORD_KEYS, `records[${index}]`, ['sizeBytes', 'entries']);
    if (row.schemaVersion !== 'v1' || row.product !== product || row.channel !== channel || row.version !== version) throw new Error(`[release manifest] record identity mismatch at ${index}`);
    const os = row.os;
    const arch = row.arch;
    if (os !== 'linux' && os !== 'darwin' && os !== 'windows') throw new Error(`[release manifest] invalid os at ${index}`);
    if (arch !== 'x64' && arch !== 'arm64') throw new Error(`[release manifest] invalid arch at ${index}`);
    const sha256 = text(row.sha256, `records[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`[release manifest] invalid sha256 at ${index}`);
    if (typeof row.rolloutPercent !== 'number' || !Number.isInteger(row.rolloutPercent) || row.rolloutPercent < 0 || row.rolloutPercent > 100) throw new Error(`[release manifest] invalid rolloutPercent at ${index}`);
    if (typeof row.critical !== 'boolean') throw new Error(`[release manifest] invalid critical at ${index}`);
    const build = object(row.build, `records[${index}].build`); exact(build, ['commitSha', 'workflowRunId'], `records[${index}].build`);
    const publication = object(row.publication, `records[${index}].publication`); exact(publication, ['workflowRunId'], `records[${index}].publication`);
    let sizeBytes: number | undefined;
    let entries: ReleaseManifestRecordV1['entries'];
    if (product === 'happier-runner') {
      sizeBytes = safeInteger(row.sizeBytes, `records[${index}].sizeBytes`, true);
      if (!Array.isArray(row.entries) || row.entries.length === 0) throw new Error(`[release manifest] invalid records[${index}].entries`);
      const paths = new Set<string>();
      entries = row.entries.map((rawEntry, entryIndex) => {
        const entry = object(rawEntry, `records[${index}].entries[${entryIndex}]`);
        const kind = entry.kind;
        const keys = kind === 'symlink' ? ['path', 'kind', 'sizeBytes', 'mode', 'linkTarget'] : ['path', 'kind', 'sizeBytes', 'mode'];
        exact(entry, keys, `records[${index}].entries[${entryIndex}]`);
        if (kind !== 'file' && kind !== 'directory' && kind !== 'symlink') throw new Error('[release manifest] invalid archive entry kind');
        const path = text(entry.path, `records[${index}].entries[${entryIndex}].path`);
        const collisionKey = path.normalize('NFC').toLowerCase();
        if (paths.has(collisionKey)) throw new Error('[release manifest] duplicate archive entry path');
        paths.add(collisionKey);
        const mode = safeInteger(entry.mode, 'archive entry mode');
        if (mode > 0o7777) throw new Error('[release manifest] invalid archive entry mode');
        return { path, kind, sizeBytes: safeInteger(entry.sizeBytes, 'archive entry sizeBytes'), mode,
          ...(kind === 'symlink' ? { linkTarget: text(entry.linkTarget, 'archive entry linkTarget') } : {}) };
      });
    } else if (row.sizeBytes !== undefined || row.entries !== undefined) {
      throw new Error('[release manifest] Runner archive metadata is not valid for this product');
    }
    return { schemaVersion: 'v1', product, channel, version, os, arch,
      url: text(row.url, `records[${index}].url`), sha256,
      signature: text(row.signature, `records[${index}].signature`),
      publishedAt: text(row.publishedAt, `records[${index}].publishedAt`),
      minSupportedVersion: nullableText(row.minSupportedVersion, `records[${index}].minSupportedVersion`),
      rolloutPercent: row.rolloutPercent, critical: row.critical,
      notesUrl: nullableText(row.notesUrl, `records[${index}].notesUrl`),
      build: { commitSha: nullableText(build.commitSha, 'build.commitSha'), workflowRunId: nullableText(build.workflowRunId, 'build.workflowRunId') },
      publication: { workflowRunId: nullableText(publication.workflowRunId, 'publication.workflowRunId') },
      ...(sizeBytes === undefined ? {} : { sizeBytes, entries }) };
  });
  return { schemaVersion: 'v1', product, channel, version, publishedAt, records };
}
