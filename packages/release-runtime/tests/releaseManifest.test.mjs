import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReleaseManifestV1 } from '../dist/releaseManifest.js';

const record = {
  schemaVersion: 'v1', product: 'happier-runner', channel: 'stable', version: '0.3.0',
  os: 'linux', arch: 'x64',
  url: 'https://github.com/happier-dev/happier/releases/download/runner-v0.3.0/happier-runner-v0.3.0-linux-x64.zip',
  sha256: 'a'.repeat(64),
  signature: 'https://github.com/happier-dev/happier/releases/download/runner-v0.3.0/checksums-happier-runner-v0.3.0.txt.minisig',
  publishedAt: '2026-09-08T00:00:00.000Z', minSupportedVersion: null, rolloutPercent: 100, critical: false,
  notesUrl: null, build: { commitSha: 'b'.repeat(40), workflowRunId: '123' }, publication: { workflowRunId: '456' },
  sizeBytes: 123,
  entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 100, mode: 0o755 }],
};

test('parseReleaseManifestV1 accepts the canonical immutable Runner publication', () => {
  const manifest = parseReleaseManifestV1({ schemaVersion: 'v1', product: 'happier-runner', channel: 'stable',
    version: '0.3.0', publishedAt: record.publishedAt, records: [record] });
  assert.equal(manifest.records[0].sha256, 'a'.repeat(64));
  assert.equal(manifest.records[0].sizeBytes, 123);
});

test('parseReleaseManifestV1 rejects unknown fields and inconsistent record identity', () => {
  const base = { schemaVersion: 'v1', product: 'happier-runner', channel: 'stable', version: '0.3.0',
    publishedAt: record.publishedAt, records: [record] };
  assert.throws(() => parseReleaseManifestV1({ ...base, surprise: true }), /unknown field/);
  assert.throws(() => parseReleaseManifestV1({ ...base, records: [{ ...record, version: '0.3.1' }] }), /identity/);
  assert.throws(() => parseReleaseManifestV1({ ...base, records: [{ ...record, sha256: 'A'.repeat(64) }] }), /sha256/);
  assert.throws(() => parseReleaseManifestV1({ ...base, records: [{ ...record, sizeBytes: 0 }] }), /sizeBytes/);
  assert.throws(() => parseReleaseManifestV1({ ...base, records: [{ ...record, entries: [...record.entries, record.entries[0]] }] }), /duplicate/);
});

test('parseReleaseManifestV1 keeps released non-Runner v1 records readable without Runner layout metadata', () => {
  const oldRecord = { ...record, product: 'happier' };
  delete oldRecord.sizeBytes;
  delete oldRecord.entries;
  const manifest = parseReleaseManifestV1({ schemaVersion: 'v1', product: 'happier', channel: 'stable',
    version: '0.3.0', publishedAt: record.publishedAt, records: [oldRecord] });
  assert.equal(manifest.records[0].sizeBytes, undefined);
});
