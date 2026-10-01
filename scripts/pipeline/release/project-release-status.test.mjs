import test from 'node:test';
import assert from 'node:assert/strict';

import { projectReleaseStatus } from './project-release-status.mjs';

test('nightly status preserves an independently verified sibling after grouped failure', () => {
  const status = projectReleaseStatus('nightly', {
    RELEASE_RUN: '42',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/42',
    RELEASE_RUN_NAME: 'NIGHTLY — Dev Releases',
    SOURCE_SHA: 'a'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'failure',
    CLI_CANDIDATE_RESULT: 'success',
    CLI_CANDIDATE_VERSION: '1.2.3-dev.4',
    CLI_RESUME_VERIFIED: 'true',
    DESKTOP_ORIGIN_RUN_ID: '37',
  });

  const cli = status.surfaces.find((surface) => surface.id === 'cli-immutable-candidate');
  assert.equal(cli?.state, 'complete');
  assert.equal(cli?.identity?.verified, true);
  assert.equal(status.surfaces.find((surface) => surface.id === 'ui_desktop')?.identity?.candidateOriginRunId, 37);
  assert.equal(status.terminal, 'failed');
});

test('nightly status records the verified Runner candidate and rolling dev release', () => {
  const status = projectReleaseStatus('nightly', {
    RELEASE_RUN: '46',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/46',
    RELEASE_RUN_NAME: 'NIGHTLY — Dev Releases',
    SOURCE_SHA: 'e'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'success',
    POST_PROMOTION_RESULT: 'success',
    RUNNER_CANDIDATE_RESULT: 'success',
    RUNNER_CANDIDATE_VERSION: '1.2.3-dev.4',
    RUNNER_RESULT: 'success',
  });

  const candidate = status.surfaces.find((surface) => surface.id === 'runner-immutable-candidate');
  assert.equal(candidate?.state, 'complete');
  assert.deepEqual(candidate?.identity, {
    sourceSha: 'e'.repeat(40),
    verified: true,
    product: 'runner',
    version: '1.2.3-dev.4',
  });
  assert.equal(status.surfaces.find((surface) => surface.id === 'runner_rolling_release')?.state, 'complete');
});

test('standard status keeps unrequested surfaces out of failure admission', () => {
  const status = projectReleaseStatus('standard', {
    RELEASE_RUN: '43',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/43',
    RELEASE_RUN_NAME: 'RELEASE — Publish (rel_abcdefgh)',
    HMAINT_OPERATION_ID: 'rel_abcdefgh',
    RELEASE_CHANNEL: 'preview',
    SOURCE_SHA: 'b'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'success',
    RELEASE_VERIFY_RESULT: 'success',
  });
  assert.equal(status.surfaces.find((surface) => surface.id === 'docker')?.state, 'not_requested');
  assert.equal(status.surfaces.find((surface) => surface.id === 'runner-immutable-candidate')?.state, 'not_requested');
  assert.equal(status.terminal, 'complete');
});

test('standard status projects a requested relay-only Docker publication failure as terminal failure', () => {
  const status = projectReleaseStatus('standard', {
    RELEASE_RUN: '47',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/47',
    RELEASE_RUN_NAME: 'RELEASE — Publish (rel_abcdefgh)',
    HMAINT_OPERATION_ID: 'rel_abcdefgh',
    RELEASE_CHANNEL: 'preview',
    SOURCE_SHA: 'f'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'success',
    RELEASE_VERIFY_RESULT: 'failure',
    REQUEST_DOCKER: 'true',
    DOCKER_RESULT: 'failure',
  });

  const docker = status.surfaces.find((surface) => surface.id === 'docker');
  assert.equal(docker?.requested, true);
  assert.equal(docker?.state, 'failed');
  assert.equal(docker?.result, 'failed');
  assert.equal(status.terminal, 'failed');
});

test('standard status records a verified Runner candidate and promoted release as one product', () => {
  const status = projectReleaseStatus('standard', {
    RELEASE_RUN: '45',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/45',
    RELEASE_RUN_NAME: 'RELEASE — Publish (rel_abcdefgh)',
    HMAINT_OPERATION_ID: 'rel_abcdefgh',
    RELEASE_CHANNEL: 'preview',
    SOURCE_SHA: 'd'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'success',
    RELEASE_VERIFY_RESULT: 'success',
    REQUEST_RUNNER: 'true',
    RUNNER_CANDIDATE_RESULT: 'success',
    RUNNER_VERSION: '1.2.3-preview.4',
    RUNNER_RESULT: 'success',
  });
  const candidate = status.surfaces.find((surface) => surface.id === 'runner-immutable-candidate');
  assert.equal(candidate?.state, 'complete');
  assert.deepEqual(candidate?.identity, {
    sourceSha: 'd'.repeat(40),
    verified: true,
    product: 'runner',
    version: '1.2.3-preview.4',
  });
  assert.equal(status.surfaces.find((surface) => surface.id === 'runner_rolling_release')?.state, 'complete');
  assert.equal(status.terminal, 'complete');
});

test('standard status records independently verified identities for each requested public SDK package', () => {
  const status = projectReleaseStatus('standard', {
    RELEASE_RUN: '44',
    RELEASE_RUN_URL: 'https://github.com/happier-dev/happier/actions/runs/44',
    RELEASE_RUN_NAME: 'RELEASE — Publish (rel_abcdefgh)',
    HMAINT_OPERATION_ID: 'rel_abcdefgh',
    RELEASE_CHANNEL: 'preview',
    SOURCE_SHA: 'c'.repeat(40),
    CANDIDATE_RESULT: 'success',
    IMMUTABLE_VERIFICATION_RESULT: 'success',
    RELEASE_VERIFY_RESULT: 'success',
    REQUEST_NPM: 'true',
    NPM_RESULT: 'success',
    REQUEST_PLUGIN_SDK: 'true',
    NPM_PLUGIN_SDK_RESULT: 'success',
    NPM_PLUGIN_SDK_VERSION: '0.1.0-preview.7',
    NPM_PLUGIN_SDK_INTEGRITY: 'sha512-plugin-sdk',
    NPM_PLUGIN_UI_RESULT: 'success',
    NPM_PLUGIN_UI_VERSION: '0.1.0-preview.7',
    NPM_PLUGIN_UI_INTEGRITY: 'sha512-plugin-ui',
    REQUEST_SDK: 'true',
    NPM_SDK_RESULT: 'success',
    NPM_SDK_VERSION: '0.1.0-preview.3',
    NPM_SDK_INTEGRITY: 'sha512-sdk',
  });

  assert.deepEqual(status.surfaces.filter((surface) => surface.id.startsWith('npm_')).map((surface) => ({
    id: surface.id,
    state: surface.state,
    identity: surface.identity,
  })), [
    {
      id: 'npm_plugin_sdk',
      state: 'complete',
      identity: {
        package: '@happier-dev/plugin-sdk',
        version: '0.1.0-preview.7',
        integrity: 'sha512-plugin-sdk',
        sourceSha: 'c'.repeat(40),
        verified: true,
      },
    },
    {
      id: 'npm_plugin_ui',
      state: 'complete',
      identity: {
        package: '@happier-dev/plugin-ui',
        version: '0.1.0-preview.7',
        integrity: 'sha512-plugin-ui',
        sourceSha: 'c'.repeat(40),
        verified: true,
      },
    },
    {
      id: 'npm_sdk',
      state: 'complete',
      identity: {
        package: '@happier-dev/sdk',
        version: '0.1.0-preview.3',
        integrity: 'sha512-sdk',
        sourceSha: 'c'.repeat(40),
        verified: true,
      },
    },
  ]);
});
