// @ts-check

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export function parseArtifactChecksums(raw) {
  const lines = String(raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return lines.map((line) => {
    const match = /^([a-fA-F0-9]{64})\s{2}(.+)$/.exec(line);
    if (!match) {
      throw new Error(`[release] invalid checksum line: ${line}`);
    }
    return { sha256: match[1].toLowerCase(), name: match[2] };
  });
}

export function parseArtifactArchiveMetadata(raw) {
  const result = new Map();
  for (const rawLine of String(raw ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('# happier-artifact-v1 ')) continue;
    let value;
    try { value = JSON.parse(line.slice('# happier-artifact-v1 '.length)); } catch { throw new Error('[release] invalid artifact metadata'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !['name', 'sizeBytes', 'entries'].includes(key))
        || typeof value.name !== 'string' || !Number.isSafeInteger(value.sizeBytes)
        || value.sizeBytes <= 0 || !Array.isArray(value.entries) || value.entries.length === 0 || result.has(value.name)) {
      throw new Error('[release] invalid artifact metadata');
    }
    result.set(value.name, { sizeBytes: value.sizeBytes, entries: value.entries });
  }
  return result;
}

export async function fileSha256(path) {
  const targetPath = String(path ?? '').trim();
  // Release packaging often runs on developer machines where file providers (or aggressive AV) can
  // briefly delay visibility of newly created archives. Treat ENOENT as a short, retryable condition.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const bytes = await readFile(targetPath);
      return createHash('sha256').update(bytes).digest('hex');
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
      if (code === 'ENOENT' && attempt < 9) {
        await delay(50);
        continue;
      }
      throw error;
    }
  }
  // unreachable: loop always returns or throws
}
