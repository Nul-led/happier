import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { CAPABILITY_MATRIX_DECLARATIONS_V1 } from './capabilityMatrixMetadata.mjs';

const EXTERNAL_AUTHOR_PROOF = 'packages/plugin-sdk/examples/action-contract-producer/src/index.ts';
const EXTERNAL_TARGET_PROOF = 'packages/plugin-sdk/fixtures/external-targeted-packages/target/src/index.ts';
const EXTERNAL_CONTRIBUTOR_PROOF = 'packages/plugin-sdk/fixtures/external-targeted-packages/contributor/src/index.ts';
const EXTERNAL_COMPOSER_AUTHOR_PROOF = 'packages/plugin-ui/fixtures/external-authoring/src/index.ts';
const EXTERNAL_COMPOSER_DOGFOOD_PROOF = 'packages/tests/fixtures/plugin-platform/composer-external-dogfood/src/index.mjs';
const CHANNELS_COMPOSER_PROOF = 'packages/plugins/channels/src/manifest.ts';

/**
 * A row is deferred only when the applicable realm has no binder or lifecycle
 * owner behind the declaration, so the host cannot serve the capability at
 * all. A missing maintained consumer is not a reason.
 */
function assertDeferredWithoutHostAuthority(declaration) {
  assert.equal(declaration.availabilityDisposition, 'deferred');
  assert.equal(declaration.lifecycle, 'declaration-only');
  assert.equal(declaration.provingConsumer, null);
  assert.equal(declaration.specialistOwner, null);
  assert.equal(declaration.lifecycleOwner, null);
  assert.match(declaration.unblockCondition, /no host authority or service owner/u);
}

function everyDeclaration() {
  return Object.entries(CAPABILITY_MATRIX_DECLARATIONS_V1).flatMap(([group, rows]) => (
    Object.entries(rows).map(([id, declaration]) => [`${group}.${id}`, declaration])
  ));
}

test('cites only consumer files that still exist in the repository', async () => {
  // A published row's consumer evidence is a claim about current source. When a
  // retired owner is deleted (Antigravity's custom/localharness session stack),
  // its rows must move to a surviving consumer instead of citing a dead path.
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const cited = everyDeclaration()
    .filter(([, declaration]) => typeof declaration.provingConsumer === 'string');
  const missing = [];
  for (const [id, declaration] of cited) {
    try {
      await readFile(resolve(repoRoot, declaration.provingConsumer), 'utf8');
    } catch {
      missing.push(`${id} -> ${declaration.provingConsumer}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('defers exactly the capabilities with no applicable-realm binder', () => {
  const deferred = everyDeclaration()
    .filter(([, declaration]) => declaration.availabilityDisposition === 'deferred')
    .map(([id]) => id)
    .sort();

  // `hostAccess/resolve.ts` resolves these three unavailable: they are declared
  // in the manifest catalog with no host authority or service owner behind
  // them. Every other capability has a producer, a public projection, and a
  // binder in the realm it applies to.
  assert.deepEqual(deferred, [
    'hostAccess.browser',
    'hostAccess.clipboard',
    'hostAccess.externalLinks',
  ]);
  for (const [, declaration] of everyDeclaration()
    .filter(([, row]) => row.availabilityDisposition === 'deferred')) {
    assertDeferredWithoutHostAuthority(declaration);
  }
});

test('decides availability without requiring a maintained consumer', () => {
  // These rows carry no maintained first-party or fixture consumer. Their
  // producer, public projection, and realm binder are what makes them
  // available; the loaded journey stays recorded separately.
  const consumerFreeAvailability = [
    ...['commands', 'tools', 'notifications', 'notificationChannels', 'voiceModelPacks',
      'daemonDatabases', 'openableContentViewers', 'mcp.servers']
      .map((family) => [`manifestFamilies.${family}`, CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies[family]]),
    ...['secrets', 'events', 'fs', 'providers', 'resources', 'mcp', 'notifications']
      .map((service) => [`services.${service}`, CAPABILITY_MATRIX_DECLARATIONS_V1.services[service]]),
    ['hostAccess.mcp', CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess.mcp],
    ['subpaths../notifications', CAPABILITY_MATRIX_DECLARATIONS_V1.subpaths['./notifications']],
  ];

  for (const [id, declaration] of consumerFreeAvailability) {
    assert.equal(declaration.availabilityDisposition, 'available', id);
    assert.equal(declaration.provingConsumer, null, id);
    assert.equal(Object.hasOwn(declaration, 'unblockCondition'), false, id);
    assert.notEqual(declaration.provingConsumer, EXTERNAL_AUTHOR_PROOF, id);
  }
});

test('HostAccess declarations name the terminal session lifecycle and no deferred host owner', () => {
  // Declarations record availability, optional consumer evidence, and the
  // exceptional lifecycle no catalog owns. Binder and lifecycle owner belong to
  // the canonical HostAccess owner map, so this file never authors them for an
  // available row.
  const terminal = CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess.terminal;
  assert.deepEqual(terminal, {
    lifecycle: 'session-runtime',
    availabilityDisposition: 'available',
    provingConsumer: 'packages/plugins/claude/src/manifest.ts',
  });
  for (const [id, declaration] of everyDeclaration()
    .filter(([, row]) => row.availabilityDisposition === 'available')) {
    assert.equal(Object.hasOwn(declaration, 'specialistOwner'), false, id);
    assert.equal(Object.hasOwn(declaration, 'lifecycleOwner'), false, id);
  }
  assert.equal(
    Object.hasOwn(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess, 'network.intercept'),
    false,
  );
  for (const capability of ['browser', 'clipboard', 'externalLinks']) {
    assert.deepEqual(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess[capability], {
      lifecycle: 'declaration-only',
      specialistOwner: null,
      lifecycleOwner: null,
      availabilityDisposition: 'deferred',
      provingConsumer: null,
      unblockCondition: CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess[capability].unblockCondition,
    });
    assertDeferredWithoutHostAuthority(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess[capability]);
  }
});

test('the cited invocation-service owner really binds every published service id', async () => {
  // Service rows cite one host binder for all of `PluginServices`. That claim
  // is only true while the host descriptor map covers exactly the published
  // ids; a published id with no host descriptor has no binder and must be
  // deferred instead.
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const [publicServices, hostServices] = await Promise.all([
    readFile(resolve(repoRoot, 'packages/plugin-sdk/src/services/index.ts'), 'utf8'),
    readFile(
      resolve(repoRoot, 'apps/cli/src/plugins/runtime/invocation/services/unavailable.ts'),
      'utf8',
    ),
  ]);
  const publishedIds = [...publicServices
    .slice(publicServices.indexOf('export type PluginServiceId'))
    .split(';')[0]
    .matchAll(/'([a-zA-Z]+)'/gu)]
    .map(([, id]) => id)
    .sort();
  const descriptors = hostServices.slice(hostServices.indexOf('export const PLUGIN_SERVICE_DESCRIPTORS'));
  const boundIds = [...descriptors.matchAll(/^ {4}([a-zA-Z]+): \{$/gmu)]
    .map(([, id]) => id)
    .sort();

  assert.equal(publishedIds.length > 0, true);
  assert.deepEqual(boundIds, publishedIds);
  for (const id of publishedIds) {
    assert.equal(
      CAPABILITY_MATRIX_DECLARATIONS_V1.services[id].availabilityDisposition,
      'available',
      id,
    );
  }
  assert.equal(descriptors.includes('createAvailable('), true);
});

test('defers exactly the HostAccess capabilities the host resolver refuses to serve', async () => {
  // The resolver is the cited HostAccess binder. Its own refusal arms are the
  // evidence for deferral, so a capability it starts serving cannot stay
  // deferred and one it stops serving cannot stay available.
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const resolver = await readFile(
    resolve(repoRoot, 'apps/cli/src/plugins/runtime/hostAccess/resolve.ts'),
    'utf8',
  );
  const refusalArm = resolver.match(
    /((?:\s*case '[a-zA-Z.]+':)+)\s*return 'unavailable';\s*\}\s*\}/u,
  );
  assert.notEqual(refusalArm, null);
  const refused = [...refusalArm[1].matchAll(/case '([a-zA-Z.]+)':/gu)].map(([, capability]) => capability).sort();

  assert.deepEqual(refused, ['browser', 'clipboard', 'externalLinks']);
  for (const [capability, declaration] of Object.entries(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess)) {
    assert.equal(
      declaration.availabilityDisposition === 'deferred',
      refused.includes(capability),
      capability,
    );
  }
});

test('publishes r0.47 browser and request-policy authoring without promoting HostAccess browser', async () => {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const availableExternalAuthorProof = {
    availabilityDisposition: 'available',
    provingConsumer: EXTERNAL_AUTHOR_PROOF,
  };

  for (const family of ['browserTargets', 'browserActions', 'requestInterceptors']) {
    assert.deepEqual(
      CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies[family],
      availableExternalAuthorProof,
    );
  }
  assert.deepEqual(CAPABILITY_MATRIX_DECLARATIONS_V1.subpaths['./browser'], availableExternalAuthorProof);
  assert.equal(CAPABILITY_MATRIX_DECLARATIONS_V1.subpaths['./http'].availabilityDisposition, 'available');
  assert.equal(
    Object.hasOwn(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess, 'network.intercept'),
    false,
  );
  assert.equal(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess.browser.availabilityDisposition, 'deferred');
  assert.equal(CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess.browser.provingConsumer, null);
  assert.equal(typeof CAPABILITY_MATRIX_DECLARATIONS_V1.hostAccess.browser.unblockCondition, 'string');

  const [browserEntrypoint, consumer] = await Promise.all([
    readFile(resolve(repoRoot, 'packages/plugin-sdk/src/browser/index.ts'), 'utf8'),
    readFile(resolve(repoRoot, EXTERNAL_AUTHOR_PROOF), 'utf8'),
  ]);
  assert.match(browserEntrypoint, /export \{ PUBLIC_TOOLCHAIN_COMPATIBILITY_V1 \} from '\.\.\/ui\/build\/publicToolchainCompatibility\.generated\.js';/u);
  assert.match(browserEntrypoint, /export \{ defineBrowserAction \} from '\.\/actions\.js';/u);
  assert.match(browserEntrypoint, /export \{ defineBrowserTarget \} from '\.\/targets\.js';/u);
  assert.match(consumer, /BrowserActionContributionInput/u);
  assert.match(consumer, /BrowserTargetContributionInput/u);
  assert.match(consumer, /PluginRequestInterceptor/u);
  assert.match(consumer, /browserTargets:\s*\{/u);
  assert.match(consumer, /browserActions:\s*\{/u);
  assert.match(consumer, /requestInterceptors:\s*\{/u);
  assert.doesNotMatch(consumer, /capability:\s*'network\.intercept'/u);
});



test('retains notification source coverage without claiming loaded lifecycle proof', async () => {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  for (const family of ['notifications', 'notificationChannels']) {
    assert.equal(
      CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies[family].availabilityDisposition,
      'available',
    );
  }
  assert.equal(CAPABILITY_MATRIX_DECLARATIONS_V1.services.notifications.availabilityDisposition, 'available');
  assert.equal(
    CAPABILITY_MATRIX_DECLARATIONS_V1.subpaths['./notifications'].availabilityDisposition,
    'available',
  );

  const consumer = await readFile(resolve(repoRoot, EXTERNAL_AUTHOR_PROOF), 'utf8');
  assert.match(consumer, /from '@happier-dev\/plugin-sdk\/notifications'/u);
  assert.match(consumer, /notifications:\s*\{/u);
  assert.match(consumer, /notificationChannels:\s*\{/u);
  assert.match(consumer, /sender:\s*documentReviewNotificationSender,/u);
  assert.match(consumer, /context\.services\.notifications\.send\(/u);
});

test('retains SecretsService source coverage without claiming loaded lifecycle proof', async () => {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  assert.equal(CAPABILITY_MATRIX_DECLARATIONS_V1.services.secrets.availabilityDisposition, 'available');

  const consumer = await readFile(resolve(repoRoot, EXTERNAL_AUTHOR_PROOF), 'utf8');
  assert.match(consumer, /secrets:\s*\[\{\s*id:\s*DOCUMENT_REVIEW_WEBHOOK_TOKEN\s*\}\]/u);
  for (const operation of ['status', 'set', 'get', 'delete']) {
    assert.match(
      consumer,
      new RegExp(`secrets\\.${operation}\\(`, 'u'),
      `external author example must invoke SecretsService.${operation}`,
    );
  }
  assert.match(consumer, /expectedRevision:\s*current\.revision/u);
});

test('records current Composer and Session-header source consumers without promoting unrecorded loaded or release proof', async () => {
  const expectedConsumers = {
    composerReferences: EXTERNAL_COMPOSER_AUTHOR_PROOF,
    composerAttachments: EXTERNAL_COMPOSER_DOGFOOD_PROOF,
    composerControls: EXTERNAL_COMPOSER_DOGFOOD_PROOF,
    composerRegions: EXTERNAL_COMPOSER_AUTHOR_PROOF,
    sessionHeaderActions: CHANNELS_COMPOSER_PROOF,
  };

  for (const [family, sourceConsumer] of Object.entries(expectedConsumers)) {
    const declaration = CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies[family];
    assert.equal(declaration.availabilityDisposition, 'available');
    assert.equal(declaration.provingConsumer, sourceConsumer);
    assert.equal(Object.hasOwn(declaration, 'unblockCondition'), false);
  }

  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const [externalAuthor, externalDogfood, channels] = await Promise.all([
    readFile(resolve(repoRoot, EXTERNAL_COMPOSER_AUTHOR_PROOF), 'utf8'),
    readFile(resolve(repoRoot, EXTERNAL_COMPOSER_DOGFOOD_PROOF), 'utf8'),
    readFile(resolve(repoRoot, CHANNELS_COMPOSER_PROOF), 'utf8'),
  ]);
  assert.match(externalAuthor, /composer:\s*\{/u);
  assert.match(externalAuthor, /references:\s*\{/u);
  assert.match(externalAuthor, /regions:\s*\{/u);
  assert.match(externalDogfood, /attachments:\s*\{/u);
  assert.match(externalDogfood, /picker:\s*ISSUE_SURFACE_RENDERER_ID/u);
  assert.match(externalDogfood, /display:\s*\{/u);
  assert.match(externalDogfood, /preview:\s*\{/u);
  assert.match(externalDogfood, /controls:\s*\{/u);
  assert.match(channels, /sessionHeaderActions:\s*\{/u);
  assert.equal(
    Object.hasOwn(CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies, 'composerReferenceProviders'),
    false,
  );
});

test('attributes contribution-point and targeted-contribution availability to the maintained external target/contributor fixture pair', async () => {
  assert.deepEqual(CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies.pluginContributionPoints, {
    availabilityDisposition: 'available',
    provingConsumer: EXTERNAL_TARGET_PROOF,
  });
  assert.deepEqual(CAPABILITY_MATRIX_DECLARATIONS_V1.manifestFamilies.targetedPluginContributions, {
    availabilityDisposition: 'available',
    provingConsumer: EXTERNAL_CONTRIBUTOR_PROOF,
  });

  // The staged proof must be the physically independent external target and
  // contributor sources: the target owns descriptor and embedded-surface
  // roles and the contributor binds them through the same public protocol
  // value, which is exactly the r0.69 Developer Preview tier the matrix row
  // advertises.
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const [target, contributor] = await Promise.all([
    readFile(resolve(repoRoot, EXTERNAL_TARGET_PROOF), 'utf8'),
    readFile(resolve(repoRoot, EXTERNAL_CONTRIBUTOR_PROOF), 'utf8'),
  ]);
  assert.match(target, /defineContributionPoint\(/u);
  assert.match(target, /descriptor:\s*\w+Schema,/u);
  assert.match(target, /surfaces:\s*\{/u);
  assert.match(contributor, /defineContributionProtocol\(/u);
  assert.match(contributor, /contributesTo:/u);
  assert.match(contributor, /surfaces:\s*\{/u);
});
