import assert from 'node:assert/strict';
import test from 'node:test';

import { wantsExpoClearCache } from './expo.mjs';

test('managed exports reuse the Metro cache unless clearing is explicitly requested', () => {
  assert.equal(wantsExpoClearCache({ env: {} }), false);
  assert.equal(wantsExpoClearCache({ env: { HAPPIER_STACK_EXPO_CLEAR_CACHE: '1' } }), true);
  assert.equal(wantsExpoClearCache({ env: { HAPPIER_STACK_EXPO_CLEAR_CACHE: '0' } }), false);
});
