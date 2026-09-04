import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLinuxHsetupResourcesOverrideConfig } from './build-updater-artifacts.mjs';

test('resolveLinuxHsetupResourcesOverrideConfig moves hsetup out of externalBin and into bundle resources', () => {
  assert.deepEqual(resolveLinuxHsetupResourcesOverrideConfig(), {
    bundle: {
      externalBin: [],
      resources: {
        'binaries/hsetup-*.gz': 'binaries/',
        '../../../packages/iroh-native/release-evidence/THIRD-PARTY-NOTICES.txt':
          'licenses/iroh-native/THIRD-PARTY-NOTICES.txt',
        '../../../packages/iroh-native/release-evidence/sbom.cdx.json':
          'licenses/iroh-native/sbom.cdx.json',
      },
    },
  });
});
