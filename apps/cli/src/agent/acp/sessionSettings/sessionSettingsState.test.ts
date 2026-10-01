import { describe, expect, it } from 'vitest';

import {
  readSessionModelStateFromConfigOptions,
  readSessionModelStateFromSessionResponse,
  readSessionModelStateFromSessionResponseAwaitable,
} from './sessionSettingsState';

describe('readSessionModelStateFromSessionResponse', () => {
  it('preserves explicit empty membership in both synchronous and awaitable projections', async () => {
    const empty = { models: { currentModelId: 'current', availableModels: [] } };
    const expected = { currentModelId: 'current', availableModels: [] };
    expect(readSessionModelStateFromSessionResponse(empty)).toEqual(expected);
    expect(await readSessionModelStateFromSessionResponseAwaitable(empty)).toEqual(expected);
    expect(await readSessionModelStateFromSessionResponseAwaitable({ models: { currentModelId: 'current', availableModels: [{}] } })).toBeNull();
  });

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
  it('preserves empty model choices without treating missing or invalid options as empty', () => {
    const option = { id: 'model', name: 'Model', type: 'select', currentValue: 'current' };
    expect(readSessionModelStateFromConfigOptions({ configOptions: [option] }, 'model')).toBeNull();
    expect(readSessionModelStateFromConfigOptions({ configOptions: [{ ...option, options: [{}] }] }, 'model')).toBeNull();
    expect(readSessionModelStateFromConfigOptions({ configOptions: [{ ...option, options: [] }] }, 'model')).toEqual({
      currentModelId: 'current', availableModels: [],
    });
  });

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
