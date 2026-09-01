import { describe, expect, it } from 'vitest';

import { projectPluginTransactionChangeResult } from './transactionChangeResult';

describe('projectPluginTransactionChangeResult', () => {
  it('does not fabricate applied generation truth when no runtime adoption settled', () => {
    expect(projectPluginTransactionChangeResult({
      pluginId: 'com.example.agent',
      desiredGeneration: 'generation-desired',
      transaction: null,
    })).toEqual({
      kind: 'committed',
      pluginId: 'com.example.agent',
      desiredGeneration: 'generation-desired',
      appliedGeneration: null,
      pendingSurfaces: [],
    });
  });
});
