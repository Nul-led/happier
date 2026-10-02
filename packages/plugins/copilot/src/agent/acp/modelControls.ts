import type { AgentAcpModelControls, AgentAcpModelOption } from '@happier-dev/plugin-sdk/agents/runtime';

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}

function choices(raw: unknown): NonNullable<AgentAcpModelOption['options']> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const option = record(entry);
    if (!option) return [];
    // ACP select options are either flat choices or one level of groups.
    const values = Array.isArray(option.options) ? option.options : [option];
    return values.flatMap((value) => {
      const choice = record(value);
      return choice && typeof choice.value === 'string' && typeof choice.name === 'string'
        ? [{ value: choice.value, name: choice.name, ...(typeof choice.description === 'string' ? { description: choice.description } : {}) }]
        : [];
    });
  });
}

function effortOptions(raw: readonly unknown[]): AgentAcpModelOption[] {
  return raw.flatMap((entry) => {
    const option = record(entry);
    if (!option || (option.category !== 'thought_level' && option.id !== 'reasoning_effort')
      || typeof option.id !== 'string' || typeof option.name !== 'string'
      || option.type !== 'select' || typeof option.currentValue !== 'string') return [];
    return [{ id: option.id, name: option.name, type: option.type, currentValue: option.currentValue,
      ...(typeof option.description === 'string' ? { description: option.description } : {}), options: choices(option.options) }];
  });
}

export function projectCopilotPreflightModels(response: unknown): unknown[] | null {
  const session = record(response);
  if (!session) return null;
  const configOptions = Array.isArray(session.configOptions) ? session.configOptions : null;
  const selector = configOptions?.map(record).find((option) => option?.id === 'model');
  const state = record(session.models);
  const currentModelId = selector?.currentValue ?? state?.currentModelId;
  const models = Array.isArray(state?.availableModels) ? state.availableModels
    : selector ? choices(selector.options).map((option) => ({ modelId: option.value, name: option.name })) : null;
  if (!models) return null;
  const observedOptions = configOptions ? effortOptions(configOptions) : null;
  return models.map((rawModel) => {
    const model = record(rawModel);
    if (!model || (model.id ?? model.modelId) !== currentModelId || !observedOptions?.length) return rawModel;
    return { ...model, modelOptions: [...(Array.isArray(model.modelOptions) ? model.modelOptions.filter((entry) => {
      const option = record(entry);
      return !observedOptions.some((observed) => observed.id === option?.id);
    }) : []), ...observedOptions] };
  });
}

export const COPILOT_ACP_MODEL_CONTROLS = Object.freeze({
  projectModel: (_raw, normalized) => normalized,
  projectSetModelResponse: ({ response, requestedModelId, targetModel }) => {
    const configOptions = record(response)?.configOptions;
    if (!Array.isArray(configOptions)) return null;
    const selected = configOptions.map(record).find((option) => option?.id === 'model');
    if (selected?.currentValue !== requestedModelId) return null;
    const observed = effortOptions(configOptions);
    const retainedOptions = targetModel.modelOptions?.filter((option) => option.id !== 'reasoning_effort'
      && !observed.some((current) => current.id === option.id));
    const modelOptions = [...(retainedOptions ?? []), ...observed];
    const { modelOptions: _previousOptions, ...model } = targetModel;
    return { ...model, ...(modelOptions.length ? { modelOptions } : {}) };
  },
} satisfies AgentAcpModelControls);
