import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createIrohTestControllerFromNativeAddon } from './irohTestController';

describe('native IrohTestController', () => {
  const addonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH?.trim();

  it.skipIf(!addonPath)('drives the feature-gated native topology owner and restores isolation', async () => {
    const requireFromAddon = createRequire(pathToFileURL(addonPath!));
    const controller = createIrohTestControllerFromNativeAddon(requireFromAddon(addonPath!));

    await controller.forceDirectOnly();
    expect(controller.getObservedPath()).toBe('unknown');
    await controller.restoreAutomatic();
    expect(controller.getObservedPath()).toBe('unknown');

    await controller.forceRelayOnly();
    expect(controller.getObservedPath()).toBe('unknown');
    await controller.restoreAutomatic();
    expect(controller.getObservedPath()).toBe('unknown');
  });
});
