import { createPluginTestkit } from '@happier-dev/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';

import { activate } from './manifest.js';
import { PLUGIN_MANIFEST } from './manifest.js';

describe('Qwen activation', () => {
  it('leaves Qwen ACP and resume-only listing to their shared host owners', async () => {
    const activation = await createPluginTestkit({ manifest: PLUGIN_MANIFEST, module: { activate } });
    try {
      expect(activation.registrations()).not.toContainEqual({ family: 'agents', localId: 'qwen' });
      expect(activation.registration('agents', 'qwen')).toBeUndefined();
    } finally {
      await activation.dispose();
    }
  });
});
