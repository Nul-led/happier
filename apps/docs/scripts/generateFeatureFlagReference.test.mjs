import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

test('canonical feature-reference inputs omit the retired plugin UI dev-server tier', () => {
  const protocolCatalog = readFileSync(
    join(REPO, 'packages', 'protocol', 'src', 'features', 'catalog.ts'),
    'utf8',
  );
  const uiRegistry = readFileSync(
    join(REPO, 'apps', 'ui', 'sources', 'sync', 'domains', 'features', 'registry', 'uiFeatureRegistry.ts'),
    'utf8',
  );

  assert.doesNotMatch(protocolCatalog, /plugins\.ui\.reactNativeBundles\.devHotReload/u);
  assert.doesNotMatch(uiRegistry, /plugins\.ui\.reactNativeBundles\.devHotReload/u);
});
