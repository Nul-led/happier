import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  inspectReleaseResumeOrigin,
  resolveReleaseResume,
} from './resolve-release-resume.mjs';
import { projectReleaseStatus } from './project-release-status.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const REPOSITORY = 'happier-dev/happier';
const RUN_ID = 31495263783;

function originRun(overrides = {}) {
  return {
    id: RUN_ID,
    run_number: 337,
    path: '.github/workflows/nightly-dev.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    head_sha: SOURCE_SHA,
    head_branch: 'dev',
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    ...overrides,
  };
}

function statusArtifact(overrides = {}) {
  return {
    id: 1234,
    name: 'happier-release-status',
    expired: false,
    digest: DIGEST,
    workflow_run: { id: RUN_ID, head_sha: SOURCE_SHA },
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'happier.release-status.v1',
    run: {
      id: RUN_ID,
      url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
      name: 'NIGHTLY — Dev Releases',
    },
    channel: 'dev',
    sourceSha: SOURCE_SHA,
    surfaces: [
      {
        id: 'cli-immutable-candidate',
        requested: true,
        required: true,
        evidence: 'verified',
        state: 'complete',
        result: 'success',
        identity: {
          verified: true,
          product: 'cli',
          sourceSha: SOURCE_SHA,
          version: '0.2.10-dev.73',
        },
      },
      {
        id: 'server-immutable-candidate',
        requested: true,
        required: true,
        evidence: 'verified',
        state: 'failed',
        result: 'failed',
      },
    ],
    terminal: 'failed',
    ...overrides,
  };
}

const expected = {
  repository: REPOSITORY,
  workflowPath: '.github/workflows/nightly-dev.yml',
  channel: 'dev',
};

test('standard release resume retains successful mobile flows only under their saved exact Expo action', () => {
  const operationId = 'rel_mobilereuse37';
  const releaseStatus = (expoAction) => projectReleaseStatus('standard', {
    SOURCE_SHA, RELEASE_RUN: String(RUN_ID), RELEASE_RUN_URL: originRun().html_url,
    RELEASE_RUN_NAME: `RELEASE ${operationId}`, RELEASE_CHANNEL: 'preview', HMAINT_OPERATION_ID: operationId,
    REQUEST_CLI: 'true', CLI_CANDIDATE_RESULT: 'success', CLI_VERSION: '0.2.10-preview.73',
    IMMUTABLE_VERIFICATION_RESULT: 'success', REQUEST_DEPLOY_UI: 'true', DEPLOY_UI_RESULT: 'failure',
    DEPLOY_UI_EXPO_ACTION: expoAction,
  });
  const flows = [
    ['promote', ['Publish Android OTA from validated bytes', 'Publish iOS OTA from validated bytes']],
    ['Mobile native (local runner) / Build (ios)', ['EAS build (local runner) (pipeline)']],
    ['Mobile native (local runner) / Build (android)', ['EAS build (local runner) (pipeline)']],
    ['Mobile APK release (local runner) / Build (android)', ['EAS build (local runner) (pipeline)']],
  ];
  const jobs = flows.map(([name, steps], index) => ({
    id: 2000 + index, run_id: RUN_ID, head_sha: SOURCE_SHA,
    name: `deploy_ui / ${name}`, status: 'completed', conclusion: 'success',
    steps: steps.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  }));
  const input = {
    originRun: originRun({ path: '.github/workflows/release.yml' }), artifacts: [statusArtifact()], downloadedDigest: DIGEST,
    status: releaseStatus('native_submit'), jobs: [{ jobs }],
    expected: { repository: REPOSITORY, workflowPath: '.github/workflows/release.yml', channel: 'preview', sourceSha: SOURCE_SHA, operationId },
  };
  const nativeComplete = { ota: false, nativeIos: true, nativeAndroid: true, apk: true };
  const incomplete = { ota: false, nativeIos: false, nativeAndroid: false, apk: false };
  assert.equal(input.status.surfaces.find((surface) => surface.id === 'deploy_ui').identity.expoAction, 'native_submit');
  assert.equal(resolveReleaseResume(input).uiExpoAction, 'native_submit');
  assert.deepEqual(resolveReleaseResume(input).uiCompleted, nativeComplete);
  assert.equal(resolveReleaseResume({ ...input, status: releaseStatus('native') }).uiExpoAction, 'native', 'build-only evidence retains its original mode');
  assert.deepEqual(resolveReleaseResume({ ...input, status: releaseStatus('ota') }).uiCompleted, { ...incomplete, ota: true });
  assert.deepEqual(resolveReleaseResume({ ...input, status: releaseStatus(undefined) }).uiCompleted, incomplete, 'old statuses cannot prove the requested submit mode');
  assert.deepEqual(resolveReleaseResume({ ...input, status: releaseStatus('unsupported') }).uiCompleted, incomplete);
  assert.deepEqual(resolveReleaseResume({ ...input, jobs: undefined }).uiCompleted, incomplete);
  for (const patch of [{ conclusion: 'failure' }, { conclusion: 'skipped' }, { run_id: RUN_ID + 1 }, { head_sha: 'c'.repeat(40) },
    { name: 'Publish preview channel / deploy_ui / Mobile native (local runner) / Build (ios)' },
    { steps: [{ ...jobs[1].steps[0], conclusion: 'skipped' }] }]) {
    assert.deepEqual(resolveReleaseResume({ ...input, jobs: [jobs[0], { ...jobs[1], ...patch }, ...jobs.slice(2)] }).uiCompleted,
      { ...nativeComplete, nativeIos: false });
  }
  assert.deepEqual(resolveReleaseResume({ ...input, jobs: [...jobs, jobs[1]] }).uiCompleted, { ...nativeComplete, nativeIos: false });
  assert.deepEqual(resolveReleaseResume({ ...input, expected: { ...input.expected, sourceSha: '' } }).uiCompleted, incomplete);
});

test('standard release desktop recovery admits finalized artifacts from only the requested channel and exact origin', () => {
  const operationId = 'rel_desktopreuse37';
  const releaseStatus = projectReleaseStatus('standard', {
    SOURCE_SHA, RELEASE_RUN: String(RUN_ID), RELEASE_RUN_URL: originRun().html_url,
    RELEASE_RUN_NAME: `RELEASE ${operationId}`, RELEASE_CHANNEL: 'preview', HMAINT_OPERATION_ID: operationId,
    REQUEST_CLI: 'true', CLI_CANDIDATE_RESULT: 'success', CLI_VERSION: '0.2.10-preview.73',
    IMMUTABLE_VERIFICATION_RESULT: 'success', REQUEST_DEPLOY_UI: 'true', DEPLOY_UI_RESULT: 'failure',
  });
  const input = { originRun: originRun({ path: '.github/workflows/release.yml' }),
    downloadedDigest: DIGEST, status: releaseStatus,
    expected: { repository: REPOSITORY, workflowPath: '.github/workflows/release.yml', channel: 'preview', sourceSha: SOURCE_SHA, operationId },
    artifacts: [statusArtifact(), statusArtifact({ id: 101, name: 'tauri-updates-preview-linux-x86_64' }),
      statusArtifact({ id: 102, name: 'tauri-updates-production-linux-x86_64' }),
      statusArtifact({ id: 103, name: 'tauri-updates-preview-darwin-aarch64', expired: true }),
      statusArtifact({ id: 104, name: 'tauri-candidate-preview-windows-x86_64' })],
  };
  assert.deepEqual(resolveReleaseResume(input).desktop, { runNumber: 337,
    artifacts: { 'windows-x86_64': { id: 104, digest: DIGEST } },
    finalizedArtifacts: { 'linux-x86_64': { id: 101, digest: DIGEST } } });
  for (const extra of [
    statusArtifact({ id: 105, name: 'tauri-updates-preview-linux-x86_64' }),
    statusArtifact({ id: 105, name: 'tauri-updates-preview-unknown' }),
    statusArtifact({ id: 105, name: 'tauri-updates-preview-darwin-x86_64', workflow_run: { id: RUN_ID + 1, head_sha: SOURCE_SHA } }),
    statusArtifact({ id: 105, name: 'tauri-updates-preview-darwin-x86_64', digest: 'invalid' }),
    statusArtifact({ id: 105, name: 'tauri-updates-linux-x86_64' }),
  ]) assert.throws(() => resolveReleaseResume({ ...input, artifacts: [...input.artifacts, extra] }), /desktop|artifact/);
  const absentUi = { ...releaseStatus, surfaces: releaseStatus.surfaces.map((surface) => surface.id === 'deploy_ui'
    ? { ...surface, requested: false } : surface) };
  assert.equal(resolveReleaseResume({ ...input, status: absentUi }).desktop, undefined);
});

test('resume artifact download preserves binary bytes and fails on digest mismatch or failed GitHub download', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-download-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from([0x50, 0x4b, 0, 0xff, 0x80, 1]);
  const archivePath = path.join(root, 'artifact.zip');
  // GitHub's process boundary is faked; the downloader and digest policy remain real.
  fs.writeFileSync(path.join(root, 'gh'), `#!/usr/bin/env node\nprocess.stdout.write(Buffer.from(${JSON.stringify([...bytes])}));process.exitCode=Number(process.env.FAKE_GH_EXIT || 0);\n`, { mode: 0o755 });
  const download = (digest, exit = '0') => spawnSync(process.execPath, [
    new URL('./resolve-release-resume.mjs', import.meta.url).pathname, '--mode', 'download',
    '--expected-repository', REPOSITORY, '--artifact-id', '1234', '--artifact-digest', digest, '--archive-path', archivePath,
  ], { env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, FAKE_GH_EXIT: exit }, encoding: 'utf8' });
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const downloaded = download(digest);
  assert.equal(downloaded.status, 0, downloaded.stderr);
  assert.deepEqual(fs.readFileSync(archivePath), bytes);
  const corrupt = download(DIGEST);
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /digest.*match/);
  assert.notEqual(download(digest, '1').status, 0);
  fs.writeFileSync(path.join(root, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const marker = ${JSON.stringify(path.join(root, 'retried'))};
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'failed');
  process.stdout.write(Buffer.alloc(100, 0xff));
  process.stderr.write('gh: Service Unavailable (HTTP 503)');
  process.exitCode = 1;
} else {
  process.stdout.write(Buffer.from(${JSON.stringify([...bytes])}));
}
`, { mode: 0o755 });
  const retried = download(digest);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stderr, /retrying/);
  assert.deepEqual(fs.readFileSync(archivePath), bytes, 'retry replaces all partial archive bytes');
});

test('resume inspection binds one unexpired status artifact to the exact origin run and source', () => {
  assert.deepEqual(inspectReleaseResumeOrigin({
    originRun: originRun(),
    artifacts: [statusArtifact()],
    expected,
  }), {
    artifactDigest: DIGEST,
    artifactId: 1234,
    workflowSha: SOURCE_SHA,
  });
});

test('resume resolution reuses only successful verified immutable candidates', () => {
  assert.deepEqual(resolveReleaseResume({
    originRun: originRun(),
    artifacts: [statusArtifact()],
    downloadedDigest: DIGEST,
    status: status(),
    expected,
  }), {
    sourceSha: SOURCE_SHA,
    uiExpoAction: '',
    uiCompleted: { ota: false, nativeIos: false, nativeAndroid: false, apk: false },
    desktop: { runNumber: 337, artifacts: {} },
    versions: {
      cli: '0.2.10-dev.73',
      stack: '',
      server: '',
      runner: '',
      'ui-web': '',
    },
    requested: {
      cli: true,
      stack: false,
      server: true,
      runner: false,
      'ui-web': false,
    },
  });
});

test('nightly desktop resume admits exact unsigned artifacts independently of missing or expired siblings', () => {
  const workflowSha = 'c'.repeat(40);
  const desktopArtifact = (platform, id, overrides = {}) => statusArtifact({
    id, name: `tauri-candidate-dev-${platform}`, workflow_run: { id: RUN_ID, head_sha: workflowSha }, ...overrides,
  });
  const input = {
    originRun: originRun({ head_sha: workflowSha }),
    artifacts: [statusArtifact({ workflow_run: { id: RUN_ID, head_sha: workflowSha } }),
      desktopArtifact('darwin-aarch64', 101), desktopArtifact('darwin-x86_64', 102),
      desktopArtifact('linux-x86_64', 103), desktopArtifact('windows-x86_64', 104)],
    downloadedDigest: DIGEST, status: status(), expected,
  };
  assert.deepEqual(resolveReleaseResume(input).desktop, {
    runNumber: 337,
    artifacts: Object.fromEntries(['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']
      .map((platform, index) => [platform, { id: index + 101, digest: DIGEST }])),
  });
  const legacy = desktopArtifact('linux-x86_64', 103, { name: 'tauri-candidate-linux-x86_64' });
  assert.deepEqual(resolveReleaseResume({ ...input, artifacts: [input.artifacts[0], legacy] }).desktop.artifacts,
    { 'linux-x86_64': { id: 103, digest: DIGEST } }, 'predecessor single-channel nightly artifacts remain recoverable');
  assert.throws(() => resolveReleaseResume({ ...input, artifacts: [...input.artifacts, legacy] }), /duplicate desktop/);
  const desktopStatus = (candidateOriginRunId) => status({ surfaces: [...status().surfaces,
    { id: 'ui_desktop', state: 'failed', result: 'failed', identity: { sourceSha: SOURCE_SHA, verified: false, candidateOriginRunId } }] });
  assert.deepEqual(resolveReleaseResume({ ...input, status: desktopStatus(RUN_ID) }).desktop, resolveReleaseResume(input).desktop);
  assert.throws(() => resolveReleaseResume({ ...input, status: desktopStatus(RUN_ID - 1) }), new RegExp(`original desktop candidate run ${RUN_ID - 1}`));
  assert.throws(() => resolveReleaseResume({ ...input, status: desktopStatus('337\\nother=true') }), /origin run ID/);
  assert.deepEqual(resolveReleaseResume({ ...input, artifacts: [input.artifacts[0],
    desktopArtifact('darwin-aarch64', 101), desktopArtifact('linux-x86_64', 103, { expired: true })] }).desktop,
  { runNumber: 337, artifacts: { 'darwin-aarch64': { id: 101, digest: DIGEST } } });

  for (const artifacts of [
    [desktopArtifact('linux-x86_64', 103), desktopArtifact('linux-x86_64', 105)],
    [desktopArtifact('unknown', 103)],
    [desktopArtifact('linux-x86_64', 103, { name: 'tauri-candidate-preview-linux-x86_64' })],
    [desktopArtifact('linux-x86_64', 103, { workflow_run: { id: RUN_ID + 1, head_sha: workflowSha } })],
    [desktopArtifact('linux-x86_64', 103, { workflow_run: { id: RUN_ID, head_sha: SOURCE_SHA } })],
    [desktopArtifact('linux-x86_64', -1)],
    [desktopArtifact('linux-x86_64', 103, { digest: 'invalid' })],
    [desktopArtifact('linux-x86_64', 103, { expired: 'false' })],
  ]) {
    assert.throws(() => resolveReleaseResume({ ...input, artifacts: [input.artifacts[0], ...artifacts] }), /desktop|artifact/);
  }
  assert.throws(() => resolveReleaseResume({ ...input, originRun: { ...input.originRun, run_number: '337\nother=true' } }), /run number/);
});

test('resume fails closed for workflow, source, artifact, channel, or duplicate-product drift', () => {
  assert.throws(() => inspectReleaseResumeOrigin({
    originRun: originRun({ path: '.github/workflows/release.yml' }),
    artifacts: [statusArtifact()],
    expected,
  }), /workflow path/);

  assert.throws(() => inspectReleaseResumeOrigin({
    originRun: originRun(),
    artifacts: [statusArtifact({ expired: true })],
    expected,
  }), /expired/);

  assert.throws(() => resolveReleaseResume({
    originRun: originRun(),
    artifacts: [statusArtifact()],
    downloadedDigest: `sha256:${'c'.repeat(64)}`,
    status: status(),
    expected,
  }), /digest/);

  assert.throws(() => resolveReleaseResume({
    originRun: originRun(),
    artifacts: [statusArtifact()],
    downloadedDigest: DIGEST,
    status: status({ channel: 'preview' }),
    expected,
  }), /channel/);

  assert.throws(() => resolveReleaseResume({
    originRun: originRun(),
    artifacts: [statusArtifact()],
    downloadedDigest: DIGEST,
    status: status({
      surfaces: [status().surfaces[0], { ...status().surfaces[0], id: 'duplicate-cli' }],
    }),
    expected,
  }), /duplicate.*cli/);
});

test('release resume binds the conductor operation and authorized source when supplied', () => {
  const workflowSha = 'c'.repeat(40);
  const releaseExpected = {
    repository: REPOSITORY,
    workflowPath: '.github/workflows/release.yml',
    channel: 'preview',
    sourceSha: SOURCE_SHA,
    operationId: 'rel_release_20260810',
  };
  const releaseRun = originRun({ path: '.github/workflows/release.yml', head_sha: workflowSha });
  const releaseArtifact = statusArtifact({ workflow_run: { id: RUN_ID, head_sha: workflowSha } });
  const releaseStatus = status({
    operationId: 'rel_release_20260810',
    channel: 'preview',
    run: { ...status().run, name: 'RELEASE — Publish (rel_release_20260810)' },
    surfaces: [{
      ...status().surfaces[0],
      identity: { ...status().surfaces[0].identity, version: '0.2.10-preview.73' },
    }],
  });

  assert.equal(resolveReleaseResume({
    originRun: releaseRun,
    artifacts: [releaseArtifact],
    downloadedDigest: DIGEST,
    status: releaseStatus,
    expected: releaseExpected,
  }).sourceSha, SOURCE_SHA);

  assert.throws(() => resolveReleaseResume({
    originRun: releaseRun,
    artifacts: [releaseArtifact],
    downloadedDigest: DIGEST,
    status: { ...releaseStatus, operationId: 'rel_other_20260810' },
    expected: releaseExpected,
  }), /operation/);
});
