import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingAssetPlan } from '../pipeline/github/rolling-release-asset-plan.mjs';

const version = '1.2.3-preview.4';
const products = [
  ['cli', `happier-v${version}-darwin-arm64.tar.gz`, 'happier-darwin-arm64.tar.gz'],
  ['stack', `hstack-v${version}-linux-x64.tar.gz`, 'hstack-linux-x64.tar.gz'],
  ['server', `happier-server-v${version}-windows-x64.tar.gz`, 'happier-server-windows-x64.tar.gz'],
  ['UI web', `happier-ui-web-v${version}-web-any.tar.gz`, 'happier-ui-web-web-any.tar.gz'],
  ['Runner', `happier-runner-v${version}-linux-arm64.zip`, 'happier-runner-linux-arm64.zip'],
  ['UI desktop installer', `happier-ui-desktop-linux-x86_64-v${version}.AppImage`, 'happier-ui-desktop-linux-x86_64.AppImage'],
];

for (const [label, versionedName, stableName] of products) {
  test(`rolling ${label} retains the immutable payload and adds a channel alias`, () => {
    const checksumsName = `checksums-product-v${version}.txt`;
    const metadataName = 'latest.json';
    const plan = buildRollingAssetPlan({
      immutableNames: [versionedName, `${versionedName}.sig`, checksumsName, `${checksumsName}.minisig`, metadataName],
      payloadNames: [versionedName, `${versionedName}.sig`],
      version,
      rollingTag: 'product-preview',
    });

    assert.deepEqual(
      plan.filter((entry) => entry.sourceName === versionedName).sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: stableName, sourceName: versionedName },
        { name: versionedName, sourceName: versionedName },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    assert.equal(plan.some((entry) => entry.name === 'checksums-product.txt'), false);
    assert.equal(plan.filter((entry) => entry.name === metadataName).length, 1);
  });
}

test('dev rolling releases retain immutable filenames', () => {
  const sourceName = `happier-v${version}-linux-x64.tar.gz`;
  assert.deepEqual(buildRollingAssetPlan({
    immutableNames: [sourceName],
    payloadNames: [sourceName],
    version,
    rollingTag: 'cli-dev',
  }), [{ name: sourceName, sourceName }]);
});

test('rolling aliases leave signed metadata canonical', () => {
  const payloadName = `happier-v${version}-linux-x64.tar.gz`;
  const metadataNames = [
    `${payloadName}.sig`,
    `checksums-happier-v${version}.txt`,
    `checksums-happier-v${version}.txt.minisig`,
    'latest.json',
  ];
  const plan = buildRollingAssetPlan({
    immutableNames: [payloadName, ...metadataNames],
    payloadNames: [payloadName, `${payloadName}.sig`],
    version,
    rollingTag: 'cli-stable',
  });

  for (const name of metadataNames) {
    assert.deepEqual(plan.find((entry) => entry.name === name), { name, sourceName: name });
  }
});

test('rolling alias derivation fails closed on a filename collision', () => {
  const versionedName = `happier-v${version}-linux-x64.tar.gz`;
  const stableName = 'happier-linux-x64.tar.gz';
  assert.throws(() => buildRollingAssetPlan({
    immutableNames: [versionedName, stableName],
    payloadNames: [versionedName],
    version,
    rollingTag: 'cli-stable',
  }), /collides/i);
});

test('stable mobile APK retains the immutable name and adds the channel-neutral public alias', () => {
  const versionedName = `happier-production-android-v${version}.apk`;
  assert.deepEqual(buildRollingAssetPlan({
    immutableNames: [versionedName],
    payloadNames: [versionedName],
    version,
    rollingTag: 'ui-mobile-stable',
  }), [
    { name: 'happier-android.apk', sourceName: versionedName },
    { name: versionedName, sourceName: versionedName },
  ].sort((a, b) => a.name.localeCompare(b.name)));
});

test('preview mobile APK keeps its single versionless channel name', () => {
  const sourceName = 'happier-preview-android.apk';
  assert.deepEqual(buildRollingAssetPlan({
    immutableNames: [sourceName],
    payloadNames: [sourceName],
    version,
    rollingTag: 'ui-mobile-preview',
  }), [{ name: sourceName, sourceName }]);
});
