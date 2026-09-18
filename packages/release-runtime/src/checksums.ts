export function findSha256(params: Readonly<{ checksumsText: string; filename: string }>): string | null {
  const target = String(params.filename ?? '').trim();
  if (!target) throw new Error('[checksums] filename is required');

  const text = String(params.checksumsText ?? '');
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^([0-9a-fA-F]{8,})\s+(.+)$/.exec(trimmed);
    if (!m) continue;
    const hash = m[1].toLowerCase();
    const file = m[2].trim();
    if (file === target) return hash;
  }
  return null;
}

export function lookupSha256(params: Readonly<{ checksumsText: string; filename: string }>): string {
  const found = findSha256(params);
  if (found == null) {
    throw new Error(`[checksums] sha256 not found for ${String(params.filename ?? '').trim()}`);
  }
  return found;
}

export type SignedArtifactArchiveEntryV1 = Readonly<{
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  sizeBytes: number;
  mode: number;
  linkTarget?: string;
}>;

export type SignedArtifactArchiveMetadataV1 = Readonly<{
  sizeBytes: number;
  entries: readonly SignedArtifactArchiveEntryV1[];
}>;

const ARTIFACT_METADATA_PREFIX = '# happier-artifact-v1 ';

function safeInteger(value: unknown, positive = false): value is number {
  return Number.isSafeInteger(value) && (positive ? Number(value) > 0 : Number(value) >= 0);
}

/** Reads exact archive bounds carried inside the signed checksum envelope. */
export function findSignedArtifactArchiveMetadataV1(params: Readonly<{
  checksumsText: string;
  filename: string;
}>): SignedArtifactArchiveMetadataV1 | null {
  const target = String(params.filename ?? '').trim();
  let found: SignedArtifactArchiveMetadataV1 | null = null;
  for (const rawLine of String(params.checksumsText ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(ARTIFACT_METADATA_PREFIX)) continue;
    let value: unknown;
    try { value = JSON.parse(line.slice(ARTIFACT_METADATA_PREFIX.length)); } catch { throw new Error('[checksums] invalid artifact metadata'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[checksums] invalid artifact metadata');
    const record = value as Record<string, unknown>;
    if (record.name !== target) continue;
    if (found) throw new Error('[checksums] duplicate artifact metadata');
    if (Object.keys(record).some((key) => !['name', 'sizeBytes', 'entries'].includes(key))
        || !safeInteger(record.sizeBytes, true) || !Array.isArray(record.entries) || record.entries.length === 0) {
      throw new Error('[checksums] invalid artifact metadata');
    }
    const paths = new Set<string>();
    const entries = record.entries.map((rawEntry): SignedArtifactArchiveEntryV1 => {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) throw new Error('[checksums] invalid artifact entry metadata');
      const entry = rawEntry as Record<string, unknown>;
      const allowed = new Set(['path', 'kind', 'sizeBytes', 'mode', 'linkTarget']);
      if (Object.keys(entry).some((key) => !allowed.has(key)) || typeof entry.path !== 'string' || !entry.path
          || (entry.kind !== 'file' && entry.kind !== 'directory' && entry.kind !== 'symlink')
          || !safeInteger(entry.sizeBytes) || !safeInteger(entry.mode) || entry.mode > 0o7777
          || ((entry.kind === 'symlink') !== (typeof entry.linkTarget === 'string' && entry.linkTarget.length > 0))) {
        throw new Error('[checksums] invalid artifact entry metadata');
      }
      const key = entry.path.normalize('NFC').toLowerCase();
      if (paths.has(key)) throw new Error('[checksums] duplicate artifact entry metadata');
      paths.add(key);
      return { path: entry.path, kind: entry.kind, sizeBytes: entry.sizeBytes, mode: entry.mode,
        ...(entry.kind === 'symlink' ? { linkTarget: entry.linkTarget as string } : {}) };
    });
    found = { sizeBytes: record.sizeBytes, entries };
  }
  return found;
}
