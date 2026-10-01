import { asRecord, normalizeString } from './openCodeParsing.js';

const VARIANT_CONFIG_OPTION_IDS = new Set([
  'variant',
  'reasoning',
  'reasoningEffort',
  'reasoning_effort',
]);

export type OpenCodePromptModel = Readonly<{
  providerID: string;
  modelID: string;
}>;

function readConfigOption(update: Readonly<Record<string, unknown>>): Readonly<{
  id: string;
  value: unknown;
}> | null {
  const configOption = asRecord(update.configOption);
  const id = normalizeString(configOption?.id);
  if (!id || !Object.prototype.hasOwnProperty.call(configOption, 'value')) return null;
  return Object.freeze({ id, value: configOption?.value });
}

function readPromptModel(update: Readonly<Record<string, unknown>>): Readonly<{
  model: OpenCodePromptModel | null;
  hasModel: boolean;
}> {
  if (!Object.prototype.hasOwnProperty.call(update, 'modelId')) {
    return Object.freeze({ model: null, hasModel: false });
  }
  const modelId = normalizeString(update.modelId);
  if (!modelId || modelId === 'default') {
    return Object.freeze({ model: null, hasModel: true });
  }
  const separatorIndex = modelId.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= modelId.length - 1) {
    return Object.freeze({ model: null, hasModel: true });
  }
  return Object.freeze({
    model: Object.freeze({
      providerID: modelId.slice(0, separatorIndex),
      modelID: modelId.slice(separatorIndex + 1),
    }),
    hasModel: true,
  });
}

export function projectOpenCodeSessionConfiguration(
  configuration: Readonly<{
    mode?: Readonly<{ value: string | null }>;
    model: Readonly<{ value: string | null }>;
    options: Readonly<Record<string, Readonly<{ value: unknown }>>>;
  }>,
): Readonly<{
  updates: readonly Readonly<Record<string, unknown>>[];
  changed: readonly string[];
}> {
  const promptOptions = Object.entries(configuration.options).filter(
    ([id]) => id !== 'opencodeBackendMode' && id !== 'opencodeCliGeneration',
  );
  return Object.freeze({
    updates: Object.freeze([
      Object.freeze({
        modelId: configuration.model.value,
      }),
      ...(configuration.mode?.value ? [Object.freeze({ modeId: configuration.mode.value })] : []),
      ...promptOptions.map(([id, option]) => Object.freeze({
        configOption: Object.freeze({ id, value: option.value }),
      })),
    ]),
    changed: Object.freeze([
      'model',
      ...(configuration.mode?.value ? ['mode'] : []),
      ...promptOptions.map(([id]) => `options.${id}`),
    ]),
  });
}

export function normalizeOpenCodePromptConfigUpdate(update: Readonly<Record<string, unknown>>): Readonly<{
  model: OpenCodePromptModel | null;
  hasModel: boolean;
  variant: string | null;
  config: Readonly<Record<string, unknown>> | null;
  hasConfig: boolean;
}> {
  const configOption = readConfigOption(update);
  const model = readPromptModel(update);
  const variant = configOption && VARIANT_CONFIG_OPTION_IDS.has(configOption.id)
    ? normalizeString(configOption.value)
    : '';
  const configEntries = configOption && !VARIANT_CONFIG_OPTION_IDS.has(configOption.id)
    ? [[configOption.id, configOption.value]]
    : [];
  return Object.freeze({
    model: model.model,
    hasModel: model.hasModel,
    variant: variant || null,
    config: configEntries.length > 0 ? Object.freeze(Object.fromEntries(configEntries)) : null,
    hasConfig: configEntries.length > 0,
  });
}
