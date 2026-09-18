import type { PluginAgentAcpModelSuffixOptionV2 } from '@happier-dev/protocol';
import type {
  AgentAcpModel,
  AgentAcpModelControls,
  AgentAcpModelOption,
  AgentAcpModelState,
} from '@happier-dev/plugin-sdk/agents/runtime';

type TrailingOption = NonNullable<PluginAgentAcpModelSuffixOptionV2['trailingOption']>;

type SuffixVariant = Readonly<{
  model: AgentAcpModel;
  stemId: string;
  value: string;
  trailingSegment: string;
  trailingValue: string | null;
  legacyProjectedId: string;
  legacyProjectedName: string;
  baseProjectedName: string;
}>;

type ProjectedVariant = Readonly<{
  variant: SuffixVariant;
  projectedId: string;
  projectedName: string;
  exposesTrailingOption: boolean;
}>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest first, so a spelling that prefixes another still matches in full. */
function alternation(values: readonly string[]): string {
  return [...new Set(values)]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp)
    .join('|');
}

function readModelNameWords(
  value: PluginAgentAcpModelSuffixOptionV2['values'][number],
): readonly string[] {
  return value.modelNameWords ?? [value.name];
}

function readTrailingNameWords(value: TrailingOption['values'][number]): readonly string[] {
  return value.modelNameWords ?? [value.name];
}

function readTrailingSegments(declaration: PluginAgentAcpModelSuffixOptionV2): readonly string[] {
  return declaration.trailingOption?.values.map((value) => value.segment)
    ?? declaration.trailingSegments
    ?? [];
}

/**
 * The provider advertises one model per option value, encoding that value in an
 * id segment and a display-name word. The optional trailing option is parsed by
 * the same boundary but exposed only for complete, reversible variant matrices.
 */
function buildPatterns(declaration: PluginAgentAcpModelSuffixOptionV2): Readonly<{
  id: RegExp;
  primaryName: RegExp;
  trailingName: RegExp | null;
}> {
  const values = alternation(declaration.values.map((value) => value.value));
  const trailingSegments = readTrailingSegments(declaration);
  const trailing = trailingSegments.length > 0
    ? `(?:-(${alternation(trailingSegments)}))?`
    : '';
  const primaryNameWords = alternation(
    declaration.values.flatMap((value) => [...readModelNameWords(value)]),
  );
  const filler = declaration.modelNameFillerWords
    ? `(?:\\s+(?:${alternation(declaration.modelNameFillerWords)}))?`
    : '';
  const trailingNameWords = declaration.trailingOption
    ? declaration.trailingOption.values.flatMap((value) => [...readTrailingNameWords(value)])
    : trailingSegments;
  const nameTail = trailingNameWords.length > 0
    ? `(?=\\s+(?:${alternation(trailingNameWords)})$|$)`
    : '(?=$)';
  return Object.freeze({
    id: new RegExp(`^(.*)-(${values})${trailing}$`),
    primaryName: new RegExp(`\\s+(?:${primaryNameWords})${filler}${nameTail}`, 'i'),
    trailingName: declaration.trailingOption
      ? new RegExp(`\\s+(?:${alternation(trailingNameWords)})$`, 'i')
      : null,
  });
}

function parseModelId(
  modelId: string,
  patterns: ReturnType<typeof buildPatterns>,
): Readonly<{ stemId: string; value: string; trailingSegment: string }> | null {
  const match = patterns.id.exec(modelId);
  if (!match) return null;
  const [, stemId, value, trailingSegment = ''] = match;
  if (!stemId || !value) return null;
  return { stemId, value, trailingSegment };
}

function trailingValueForSegment(option: TrailingOption, segment: string): string | null {
  if (!segment) return option.defaultValue.value;
  return option.values.find((value) => value.segment === segment)?.value ?? null;
}

function parseVariant(
  model: AgentAcpModel,
  declaration: PluginAgentAcpModelSuffixOptionV2,
  patterns: ReturnType<typeof buildPatterns>,
): SuffixVariant | null {
  const parsed = parseModelId(model.id, patterns);
  if (!parsed) return null;
  const legacyProjectedName = model.name.replace(patterns.primaryName, '');
  if (legacyProjectedName === model.name || !legacyProjectedName.trim()) return null;
  const baseProjectedName = parsed.trailingSegment && patterns.trailingName
    ? legacyProjectedName.replace(patterns.trailingName, '')
    : legacyProjectedName;
  if (!baseProjectedName.trim()) return null;
  const trailingValue = declaration.trailingOption
    ? trailingValueForSegment(declaration.trailingOption, parsed.trailingSegment)
    : null;
  if (declaration.trailingOption && trailingValue === null) return null;
  return {
    model,
    stemId: parsed.stemId,
    value: parsed.value,
    trailingSegment: parsed.trailingSegment,
    trailingValue,
    legacyProjectedId: `${parsed.stemId}${parsed.trailingSegment ? `-${parsed.trailingSegment}` : ''}`,
    legacyProjectedName,
    baseProjectedName,
  };
}

function isCompleteTrailingMatrix(
  variants: readonly SuffixVariant[],
  option: TrailingOption,
): boolean {
  const primaryValues = new Set(variants.map((variant) => variant.value));
  const trailingValues = new Set(variants.map((variant) => variant.trailingValue));
  if (primaryValues.size < 2
    || !trailingValues.has(option.defaultValue.value)
    || trailingValues.size < 2) return false;
  if (new Set(variants.map((variant) => variant.baseProjectedName)).size !== 1) return false;
  const activeNames = option.values
    .filter((entry) => trailingValues.has(entry.value))
    .map((entry) => entry.name);
  if (new Set(activeNames).size !== activeNames.length) return false;
  const tuples = new Set(variants.map((variant) => `${variant.value}\u0000${variant.trailingValue}`));
  return tuples.size === variants.length
    && variants.length === primaryValues.size * trailingValues.size;
}

function buildProjectedVariants(
  declaration: PluginAgentAcpModelSuffixOptionV2,
  patterns: ReturnType<typeof buildPatterns>,
  normalizedModelState: AgentAcpModelState,
): readonly ProjectedVariant[] {
  const parsed = normalizedModelState.availableModels.flatMap((model) => {
    const variant = parseVariant(model, declaration, patterns);
    return variant ? [variant] : [];
  });
  const variantsByStem = new Map<string, SuffixVariant[]>();
  for (const variant of parsed) {
    const variants = variantsByStem.get(variant.stemId) ?? [];
    variants.push(variant);
    variantsByStem.set(variant.stemId, variants);
  }
  const trailingOptionStems = new Set(
    declaration.trailingOption
      ? [...variantsByStem.entries()]
          .filter(([stemId, variants]) => isCompleteTrailingMatrix(variants, declaration.trailingOption!)
            && !normalizedModelState.availableModels.some((model) => model.id === stemId))
          .map(([stemId]) => stemId)
      : [],
  );
  return parsed.map((variant) => trailingOptionStems.has(variant.stemId)
    ? {
        variant,
        projectedId: variant.stemId,
        projectedName: variant.baseProjectedName,
        exposesTrailingOption: true,
      }
    : {
        variant,
        projectedId: variant.legacyProjectedId,
        projectedName: variant.legacyProjectedName,
        exposesTrailingOption: false,
      });
}

function createPrimaryOption(
  declaration: PluginAgentAcpModelSuffixOptionV2,
  variants: readonly ProjectedVariant[],
  selected: ProjectedVariant,
): AgentAcpModelOption | null {
  const advertised = new Set(
    variants
      .filter((candidate) => !selected.exposesTrailingOption
        || candidate.variant.trailingValue === selected.variant.trailingValue)
      .map((candidate) => candidate.variant.value),
  );
  const values = declaration.values.filter((value) => advertised.has(value.value));
  if (values.length < 2) return null;
  return {
    id: declaration.id,
    name: declaration.name,
    type: 'select',
    currentValue: selected.variant.value,
    options: values.map((value) => ({ value: value.value, name: value.name })),
  };
}

function createTrailingOption(
  option: TrailingOption,
  variants: readonly ProjectedVariant[],
  selected: ProjectedVariant,
): AgentAcpModelOption | null {
  if (!selected.exposesTrailingOption) return null;
  const advertised = new Set(
    variants
      .filter((candidate) => candidate.variant.value === selected.variant.value)
      .map((candidate) => candidate.variant.trailingValue),
  );
  const values = [option.defaultValue, ...option.values]
    .filter((value) => advertised.has(value.value));
  if (values.length < 2) return null;
  return {
    id: option.id,
    name: option.name,
    type: 'select',
    currentValue: selected.variant.trailingValue ?? option.defaultValue.value,
    options: values.map((value) => ({ value: value.value, name: value.name })),
  };
}

function projectModelState(
  declaration: PluginAgentAcpModelSuffixOptionV2,
  patterns: ReturnType<typeof buildPatterns>,
  normalizedModelState: AgentAcpModelState,
): AgentAcpModelState {
  const projectedVariants = buildProjectedVariants(declaration, patterns, normalizedModelState);
  const variantsByProjectedId = new Map<string, ProjectedVariant[]>();
  for (const projected of projectedVariants) {
    const variants = variantsByProjectedId.get(projected.projectedId) ?? [];
    variants.push(projected);
    variantsByProjectedId.set(projected.projectedId, variants);
  }

  const collapsibleIds = new Set(
    [...variantsByProjectedId.entries()]
      .filter(([, variants]) => variants.length > 1
        && new Set(variants.map((candidate) => candidate.projectedName)).size === 1
        && new Set(variants.map((candidate) => (
          `${candidate.variant.value}\u0000${candidate.variant.trailingValue}`
        ))).size === variants.length)
      .filter(([projectedId]) => !normalizedModelState.availableModels.some(
        (model) => model.id === projectedId,
      ))
      .map(([projectedId]) => projectedId),
  );
  if (collapsibleIds.size === 0) return normalizedModelState;

  const availableModels: AgentAcpModel[] = [];
  const emittedGroups = new Set<string>();
  for (const model of normalizedModelState.availableModels) {
    const projected = projectedVariants.find((candidate) => candidate.variant.model.id === model.id);
    if (!projected || !collapsibleIds.has(projected.projectedId)) {
      availableModels.push(model);
      continue;
    }
    if (emittedGroups.has(projected.projectedId)) continue;
    emittedGroups.add(projected.projectedId);
    const variants = variantsByProjectedId.get(projected.projectedId)!;
    const selected = variants.find(
      (candidate) => candidate.variant.model.id === normalizedModelState.currentModelId,
    ) ?? variants[0]!;
    const trailingOptionId = declaration.trailingOption?.id;
    const retainedOptions = selected.variant.model.modelOptions?.filter(
      (option) => option.id !== declaration.id && option.id !== trailingOptionId,
    ) ?? [];
    const primaryOption = createPrimaryOption(declaration, variants, selected);
    const trailingOption = declaration.trailingOption
      ? createTrailingOption(declaration.trailingOption, variants, selected)
      : null;
    availableModels.push({
      ...selected.variant.model,
      id: selected.projectedId,
      name: selected.projectedName,
      modelOptions: [
        ...retainedOptions,
        ...(primaryOption ? [primaryOption] : []),
        ...(trailingOption ? [trailingOption] : []),
      ],
    });
  }

  const currentVariant = projectedVariants.find(
    (candidate) => candidate.variant.model.id === normalizedModelState.currentModelId,
  );
  return {
    currentModelId: currentVariant && collapsibleIds.has(currentVariant.projectedId)
      ? currentVariant.projectedId
      : normalizedModelState.currentModelId,
    availableModels,
  };
}

function findModel(
  modelState: AgentAcpModelState | null,
  modelId: string,
): AgentAcpModel | null {
  return modelState?.availableModels.find((model) => model.id === modelId) ?? null;
}

function readCurrentOption(model: AgentAcpModel, optionId: string): string | null {
  return model.modelOptions?.find((option) => option.id === optionId)?.currentValue ?? null;
}

function buildProviderModelId(
  model: AgentAcpModel,
  primaryValue: string,
  declaration: PluginAgentAcpModelSuffixOptionV2,
  trailingValue: string | null,
): string | null {
  const trailingOption = declaration.trailingOption;
  if (trailingOption && model.modelOptions?.some((option) => option.id === trailingOption.id)) {
    const segment = trailingValue === trailingOption.defaultValue.value
      ? ''
      : trailingOption.values.find((value) => value.value === trailingValue)?.segment;
    if (segment === undefined) return null;
    return `${model.id}-${primaryValue}${segment ? `-${segment}` : ''}`;
  }
  for (const trailingSegment of readTrailingSegments(declaration)) {
    const suffix = `-${trailingSegment}`;
    if (model.id.endsWith(suffix)) {
      return `${model.id.slice(0, -suffix.length)}-${primaryValue}${suffix}`;
    }
  }
  return `${model.id}-${primaryValue}`;
}

/**
 * Projects a provider's per-value model list into one model plus declared
 * options, and expands a Happier selection back to a provider-native id.
 */
export function buildAcpModelSuffixOptionControls(
  declaration: PluginAgentAcpModelSuffixOptionV2,
): AgentAcpModelControls {
  const patterns = buildPatterns(declaration);
  return Object.freeze({
    projectModel: (_rawModel, normalizedModel) => normalizedModel,
    projectModelState: ({ normalizedModelState }) => projectModelState(
      declaration,
      patterns,
      normalizedModelState,
    ),
    projectModelId: ({ modelId, modelState }) => {
      const parsed = parseModelId(modelId, patterns);
      if (!parsed) return modelId;
      const base = findModel(modelState, parsed.stemId);
      if (declaration.trailingOption
        && base?.modelOptions?.some((option) => option.id === declaration.trailingOption!.id)) {
        return parsed.stemId;
      }
      const legacyId = `${parsed.stemId}${parsed.trailingSegment ? `-${parsed.trailingSegment}` : ''}`;
      return findModel(modelState, legacyId)?.modelOptions?.some((option) => option.id === declaration.id)
        ? legacyId
        : modelId;
    },
    resolveModelUpdate: ({ modelId, modelState }) => {
      const model = findModel(modelState, modelId);
      if (!model) return undefined;
      const primaryValue = readCurrentOption(model, declaration.id);
      if (!primaryValue) return undefined;
      const trailingValue = declaration.trailingOption
        ? readCurrentOption(model, declaration.trailingOption.id)
        : null;
      const providerModelId = buildProviderModelId(model, primaryValue, declaration, trailingValue);
      return providerModelId ? { modelId: providerModelId } : undefined;
    },
    projectUpdate: ({ configId, value, currentModel }) => {
      const isPrimary = configId === declaration.id;
      const isTrailing = configId === declaration.trailingOption?.id;
      if ((!isPrimary && !isTrailing) || typeof value !== 'string') return undefined;
      const option = currentModel.modelOptions?.find((candidate) => candidate.id === configId);
      if (!option?.options?.some((candidate) => candidate.value === value)) {
        throw new Error(`'${configId}' is not advertised for the active model`);
      }
      const primaryValue = isPrimary ? value : readCurrentOption(currentModel, declaration.id);
      if (!primaryValue) throw new Error(`'${declaration.id}' is not advertised for the active model`);
      const trailingValue = isTrailing
        ? value
        : declaration.trailingOption
          ? readCurrentOption(currentModel, declaration.trailingOption.id)
          : null;
      const modelId = buildProviderModelId(currentModel, primaryValue, declaration, trailingValue);
      if (!modelId) throw new Error(`'${configId}' cannot be mapped to a provider model`);
      return { modelId };
    },
  });
}
