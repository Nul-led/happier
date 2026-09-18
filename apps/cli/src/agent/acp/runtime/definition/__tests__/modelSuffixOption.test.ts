import type { PluginAgentAcpModelSuffixOptionV2 } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { buildAcpModelSuffixOptionControls } from '../modelSuffixOption';

const REASONING_EFFORT: PluginAgentAcpModelSuffixOptionV2 = {
  id: 'reasoning_effort',
  name: 'Reasoning effort',
  values: [
    { value: 'none', name: 'None', modelNameWords: ['No', 'None'] },
    { value: 'low', name: 'Low' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'xhigh', name: 'XHigh', modelNameWords: ['XHigh', 'X-High'] },
    { value: 'max', name: 'Max' },
  ],
  trailingSegments: ['fast', 'priority'],
  modelNameFillerWords: ['Thinking'],
};

const REASONING_AND_SPEED = {
  id: REASONING_EFFORT.id,
  name: REASONING_EFFORT.name,
  values: REASONING_EFFORT.values,
  modelNameFillerWords: REASONING_EFFORT.modelNameFillerWords,
  trailingOption: {
    id: 'service_tier',
    name: 'Speed',
    defaultValue: { value: 'standard', name: 'Standard' },
    values: [
      { segment: 'fast', value: 'fast', name: 'Fast', modelNameWords: ['Fast'] },
      { segment: 'priority', value: 'priority', name: 'Fast', modelNameWords: ['Fast'] },
    ],
  },
} satisfies PluginAgentAcpModelSuffixOptionV2;

describe('declared ACP model suffix option', () => {
  const models = buildAcpModelSuffixOptionControls(REASONING_EFFORT);

  it('projects reversible model families into one model plus the declared option', () => {
    const rawState = {
      currentModelId: 'claude-opus-5-high',
      availableModels: [
        { id: 'claude-opus-5-low', name: 'Claude Opus 5 Low' },
        { id: 'claude-opus-5-high', name: 'Claude Opus 5 High' },
        { id: 'claude-opus-5-low-fast', name: 'Claude Opus 5 Low Fast' },
        { id: 'claude-opus-5-high-fast', name: 'Claude Opus 5 High Fast' },
        { id: 'unstructured-model', name: 'Unstructured Model Max' },
      ],
    };

    const projected = models.projectModelState?.({ normalizedModelState: rawState });
    expect(projected).toMatchObject({
      currentModelId: 'claude-opus-5',
      availableModels: [
        {
          id: 'claude-opus-5',
          name: 'Claude Opus 5',
          modelOptions: [{
            id: 'reasoning_effort',
            name: 'Reasoning effort',
            currentValue: 'high',
            options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
          }],
        },
        {
          id: 'claude-opus-5-fast',
          name: 'Claude Opus 5 Fast',
          modelOptions: [{ id: 'reasoning_effort', currentValue: 'low' }],
        },
        { id: 'unstructured-model', name: 'Unstructured Model Max' },
      ],
    });
    expect(models.resolveModelUpdate?.({
      modelId: 'claude-opus-5-fast',
      modelState: projected ?? null,
    })).toEqual({ modelId: 'claude-opus-5-low-fast' });
    expect(models.projectModelId?.({
      modelId: 'claude-opus-5-high-fast',
      modelState: projected ?? null,
    })).toBe('claude-opus-5-fast');
    expect(models.projectUpdate?.({
      configId: 'reasoning_effort',
      value: 'high',
      currentModel: projected!.availableModels[1]!,
    })).toEqual({ modelId: 'claude-opus-5-high-fast' });
  });

  it('strips a declared filler word and a multi-spelling value word from the model name', () => {
    const supported = models.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'gpt-9-xhigh',
        availableModels: [
          { id: 'gpt-9-none', name: 'GPT 9 No Thinking' },
          { id: 'gpt-9-xhigh', name: 'GPT 9 X-High Thinking' },
        ],
      },
    });
    expect(supported).toMatchObject({
      currentModelId: 'gpt-9',
      availableModels: [{
        id: 'gpt-9',
        name: 'GPT 9',
        modelOptions: [{ id: 'reasoning_effort', currentValue: 'xhigh' }],
      }],
    });
  });

  it('leaves an explicitly advertised projected model untouched instead of collapsing its family', () => {
    const projected = models.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'swe-2-high',
        availableModels: [
          { id: 'swe-2', name: 'SWE 2' },
          { id: 'swe-2-low', name: 'SWE 2 Low' },
          { id: 'swe-2-high', name: 'SWE 2 High' },
        ],
      },
    });
    expect(projected?.availableModels.map((model) => model.id).sort())
      .toEqual(['swe-2', 'swe-2-high', 'swe-2-low']);
    expect(projected?.currentModelId).toBe('swe-2-high');
  });

  it('refuses an option value the active model does not advertise', () => {
    const projected = models.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'swe-3-low',
        availableModels: [
          { id: 'swe-3-low', name: 'SWE 3 Low' },
          { id: 'swe-3-high', name: 'SWE 3 High' },
        ],
      },
    });
    expect(() => models.projectUpdate?.({
      configId: 'reasoning_effort',
      value: 'max',
      currentModel: projected!.availableModels[0]!,
    })).toThrow(/reasoning_effort/);
  });

  it('projects a complete trailing-segment matrix into a second model option', () => {
    const controls = buildAcpModelSuffixOptionControls(REASONING_AND_SPEED);
    const projected = controls.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'gpt-5-6-sol-high-priority',
        availableModels: [
          { id: 'gpt-5-6-sol-low', name: 'GPT-5.6 Sol Low Thinking' },
          { id: 'gpt-5-6-sol-high', name: 'GPT-5.6 Sol High Thinking' },
          { id: 'gpt-5-6-sol-low-priority', name: 'GPT-5.6 Sol Low Thinking Fast' },
          { id: 'gpt-5-6-sol-high-priority', name: 'GPT-5.6 Sol High Thinking Fast' },
        ],
      },
    });

    expect(projected).toMatchObject({
      currentModelId: 'gpt-5-6-sol',
      availableModels: [{
        id: 'gpt-5-6-sol',
        name: 'GPT-5.6 Sol',
        modelOptions: [
          { id: 'reasoning_effort', currentValue: 'high' },
          {
            id: 'service_tier',
            name: 'Speed',
            currentValue: 'priority',
            options: [
              { value: 'standard', name: 'Standard' },
              { value: 'priority', name: 'Fast' },
            ],
          },
        ],
      }],
    });
    expect(controls.projectUpdate?.({
      configId: 'service_tier',
      value: 'standard',
      currentModel: projected!.availableModels[0]!,
    })).toEqual({ modelId: 'gpt-5-6-sol-high' });
    expect(controls.projectUpdate?.({
      configId: 'reasoning_effort',
      value: 'low',
      currentModel: projected!.availableModels[0]!,
    })).toEqual({ modelId: 'gpt-5-6-sol-low-priority' });
  });

  it('does not expose the trailing option for an incomplete matrix', () => {
    const controls = buildAcpModelSuffixOptionControls(REASONING_AND_SPEED);
    const projected = controls.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'gpt-5-6-sol-high-priority',
        availableModels: [
          { id: 'gpt-5-6-sol-low', name: 'GPT-5.6 Sol Low Thinking' },
          { id: 'gpt-5-6-sol-high', name: 'GPT-5.6 Sol High Thinking' },
          { id: 'gpt-5-6-sol-high-priority', name: 'GPT-5.6 Sol High Thinking Fast' },
        ],
      },
    });

    expect(projected).toMatchObject({
      currentModelId: 'gpt-5-6-sol-high-priority',
      availableModels: [
        { id: 'gpt-5-6-sol', modelOptions: [{ id: 'reasoning_effort' }] },
        { id: 'gpt-5-6-sol-high-priority' },
      ],
    });
  });

  it('retains reversible primary options on each speed model for a partial matrix', () => {
    const controls = buildAcpModelSuffixOptionControls(REASONING_AND_SPEED);
    const projected = controls.projectModelState?.({
      normalizedModelState: {
        currentModelId: 'gpt-5-6-sol-high-priority',
        availableModels: [
          { id: 'gpt-5-6-sol-low', name: 'GPT-5.6 Sol Low Thinking' },
          { id: 'gpt-5-6-sol-high', name: 'GPT-5.6 Sol High Thinking' },
          { id: 'gpt-5-6-sol-max', name: 'GPT-5.6 Sol Max Thinking' },
          { id: 'gpt-5-6-sol-low-priority', name: 'GPT-5.6 Sol Low Thinking Fast' },
          { id: 'gpt-5-6-sol-high-priority', name: 'GPT-5.6 Sol High Thinking Fast' },
        ],
      },
    });

    expect(projected?.currentModelId).toBe('gpt-5-6-sol-priority');
    const fastModel = projected?.availableModels.find((model) => model.id === 'gpt-5-6-sol-priority');
    expect(fastModel).toMatchObject({
      name: 'GPT-5.6 Sol Fast',
      modelOptions: [{ id: 'reasoning_effort', currentValue: 'high' }],
    });
    expect(controls.projectUpdate?.({
      configId: 'reasoning_effort',
      value: 'low',
      currentModel: fastModel!,
    })).toEqual({ modelId: 'gpt-5-6-sol-low-priority' });
  });

  it('keeps single-primary-value speed variants separate when their raw ids need that value', () => {
    const controls = buildAcpModelSuffixOptionControls(REASONING_AND_SPEED);
    const state = {
      currentModelId: 'single-high-fast',
      availableModels: [
        { id: 'single-high', name: 'Single High' },
        { id: 'single-high-fast', name: 'Single High Fast' },
      ],
    };

    expect(controls.projectModelState?.({ normalizedModelState: state })).toEqual(state);
  });
});
