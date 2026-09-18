import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManifestRecord, parseArtifactFilename } from '../pipeline/release/lib/manifests.mjs';

test('parseArtifactFilename parses expected artifact format', () => {
  const parsed = parseArtifactFilename('happier-v1.2.3-linux-x64.tar.gz');
  assert.deepEqual(parsed, {
    product: 'happier',
    version: '1.2.3',
    os: 'linux',
    arch: 'x64',
    filename: 'happier-v1.2.3-linux-x64.tar.gz',
  });
});

test('parseArtifactFilename accepts prerelease versions containing hyphens', () => {
  const parsed = parseArtifactFilename('happier-v0.1.0-preview.71.1-linux-x64.tar.gz');
  assert.deepEqual(parsed, {
    product: 'happier',
    version: '0.1.0-preview.71.1',
    os: 'linux',
    arch: 'x64',
    filename: 'happier-v0.1.0-preview.71.1-linux-x64.tar.gz',
  });
});

test('parseArtifactFilename rejects invalid names', () => {
  assert.equal(parseArtifactFilename('happier-linux-x64.tar.gz'), null);
  assert.equal(parseArtifactFilename('happier-v1.2.3-linux-ppc.tar.gz'), null);
});

test('parseArtifactFilename parses the separately composed Runner product', () => {
  assert.deepEqual(parseArtifactFilename('happier-runner-v0.3.0-darwin-arm64.zip'), {
    product: 'happier-runner',
    version: '0.3.0',
    os: 'darwin',
    arch: 'arm64',
    filename: 'happier-runner-v0.3.0-darwin-arm64.zip',
  });
});

test('Runner rejects the retired unpublished tar format', () => {
  assert.equal(parseArtifactFilename('happier-runner-v0.3.0-linux-x64.tar.gz'), null);
});

test('parseArtifactFilename does not fold the Runner product into the CLI product', () => {
  assert.equal(parseArtifactFilename('happier-v0.3.0-linux-x64.tar.gz')?.product, 'happier');
  assert.equal(parseArtifactFilename('happier-runnerx-v0.3.0-linux-x64.tar.gz'), null);
});

test('buildManifestRecord publishes happier-runner records', () => {
  const record = buildManifestRecord({
    product: 'happier-runner',
    channel: 'preview',
    version: '0.3.0-preview.1',
    os: 'windows',
    arch: 'x64',
    url: 'https://example.com/happier-runner-v0.3.0-preview.1-windows-x64.zip',
    sha256: 'c'.repeat(64),
    sizeBytes: 123,
    entries: [{ path: 'Happier Runner.exe', kind: 'file', sizeBytes: 100, mode: 0o755 }],
  });
  assert.equal(record.product, 'happier-runner');
  assert.equal(record.os, 'windows');
});

test('buildManifestRecord includes required fields and defaults', () => {
  const record = buildManifestRecord({
    product: 'hstack',
    channel: 'stable',
    version: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    url: 'https://example.com/hstack-v0.1.0-darwin-arm64.tar.gz',
    sha256: 'abc123',
  });
  assert.equal(record.product, 'hstack');
  assert.equal(record.channel, 'stable');
  assert.equal(record.rolloutPercent, 100);
  assert.equal(record.critical, false);
  assert.equal(typeof record.publishedAt, 'string');
});

test('buildManifestRecord accepts publicdev as a rolling prerelease channel', () => {
  const record = buildManifestRecord({
    product: 'happier',
    channel: 'publicdev',
    version: '0.1.0-publicdev.1',
    os: 'linux',
    arch: 'x64',
    url: 'https://example.com/happier-v0.1.0-publicdev.1-linux-x64.tar.gz',
    sha256: 'def456',
  });

  assert.equal(record.channel, 'publicdev');
});
