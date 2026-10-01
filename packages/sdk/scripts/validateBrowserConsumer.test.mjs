import test from 'node:test';
import { validateBrowserConsumer } from './validateBrowserConsumer.mjs';

test('the current-source public SDK bundles for browsers and executes an Action through fetch', async () => {
  await validateBrowserConsumer();
});
