import { describe, expect, it } from 'vitest';

import * as protocolRoot from '../../index.js';
import * as pluginUiProtocol from './index.js';

const REMOVED_EXACT_RUNTIME_COMPATIBILITY_EXPORTS = [
  'PluginReactNativeCompatibilityInputV1Schema',
  'PluginUiArtifactCompatibilityKeyV1Schema',
  'PluginUiExactRuntimeVersionV1Schema',
  'derivePluginUiNativeCapabilitiesDigestV1',
] as const;

describe('Plugin UI artifact compatibility public contract', () => {
  it('does not publish obsolete exact React or React Native compatibility owners', () => {
    for (const exportName of REMOVED_EXACT_RUNTIME_COMPATIBILITY_EXPORTS) {
      expect(protocolRoot).not.toHaveProperty(exportName);
      expect(pluginUiProtocol).not.toHaveProperty(exportName);
    }
  });
});
