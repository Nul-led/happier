import type { AgentModelOption } from '../../models/descriptor.js';

type AnthropicModelOption = AgentModelOption;

export const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AnthropicEffortLevel = (typeof ANTHROPIC_EFFORT_LEVELS)[number];

export function normalizeAnthropicModelDisplayName(nameRaw: unknown, fallback: string): string {
  const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  const prefixed = /^claude\s+(.+)$/iu.exec(name);
  return prefixed?.[1]?.trim() || name || fallback.trim();
}

export function formatAnthropicEffortLevelLabel(level: AnthropicEffortLevel): string {
  switch (level) {
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'xhigh': return 'XHigh';
    case 'max': return 'Max';
  }
}

export function buildAnthropicModelOptions(input: Readonly<{
  supportedLevels: readonly AnthropicEffortLevel[];
  defaultEffort?: AnthropicEffortLevel | null;
}>): readonly AnthropicModelOption[] {
  const supported = new Set(input.supportedLevels);
  const levels = ANTHROPIC_EFFORT_LEVELS.filter((level) => supported.has(level));
  if (levels.length === 0) return [];

  const currentValue = input.defaultEffort && supported.has(input.defaultEffort)
    ? input.defaultEffort
    : supported.has('high')
      ? 'high'
      : levels[levels.length - 1]!;
  const options: AnthropicModelOption[] = [{
    id: 'reasoning_effort',
    name: 'Thinking',
    type: 'select',
    currentValue,
    options: levels.map((level) => ({ value: level, name: formatAnthropicEffortLevelLabel(level) })),
  }];

  if (supported.has('xhigh')) {
    options.push({
      id: 'ultracode',
      name: 'Ultracode',
      description: 'Maximum coding effort. Forces XHigh Thinking effort while enabled.',
      type: 'boolean',
      currentValue: 'false',
      overridesWhenOn: { optionIds: ['reasoning_effort'], forcedValue: 'xhigh' },
    });
  }
  return options;
}

