import { describe, expect, it } from 'vitest';

import {
  readSessionModelStateFromConfigOptions,
  readSessionModelStateFromSessionResponse,
} from './sessionSettingsState';

describe('readSessionModelStateFromSessionResponse', () => {
  it('rejects provider model state whose current model is not advertised', () => {
    expect(readSessionModelStateFromSessionResponse({
      models: {
        currentModelId: 'missing-current',
        availableModels: [
          { id: 'advertised-model', name: 'Advertised model' },
        ],
      },
    })).toBeNull();
  });
});

describe('readSessionModelStateFromConfigOptions', () => {
  it('projects an ACP select config option into canonical model state', () => {
    expect(readSessionModelStateFromConfigOptions({
      configOptions: [{
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'model-b',
        options: [
          { value: 'model-a', name: 'Model A' },
          { value: 'model-b', name: 'Model B', description: 'Accurate' },
        ],
      }],
    }, 'model')).toEqual({
      currentModelId: 'model-b',
      availableModels: [
        { id: 'model-a', name: 'Model A' },
        { id: 'model-b', name: 'Model B', description: 'Accurate' },
      ],
    });
  });
});
