import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_STATIC_MODELS,
  buildAnthropicModelOptions,
  isAnthropic1mAlwaysOnModelId,
  isAnthropic1mContextOptInModelId,
  normalizeAnthropicModelDisplayName,
} from './catalog.js';

describe('Anthropic Provider catalog', () => {
  it('uses provider-relative labels without rewriting non-Anthropic gateway names', () => {
    expect(normalizeAnthropicModelDisplayName('Claude Future 6', 'claude-future-6')).toBe('Future 6');
    expect(normalizeAnthropicModelDisplayName('GLM 4.6', 'glm-4.6')).toBe('GLM 4.6');
    expect(normalizeAnthropicModelDisplayName(undefined, 'claude-future-6')).toBe('claude-future-6');
  });

  it('owns the static model options consumed by both Provider discovery and the Claude Agent', () => {
    expect(ANTHROPIC_STATIC_MODELS.find(({ id }) => id === 'claude-opus-5')?.modelOptions)
      .toEqual(buildAnthropicModelOptions({
        supportedLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
      }));
    expect(isAnthropic1mAlwaysOnModelId('claude-opus-5')).toBe(true);
    expect(isAnthropic1mContextOptInModelId('claude-opus-4-6')).toBe(true);
    expect(ANTHROPIC_STATIC_MODELS.find(({ id }) => id === 'claude-opus-4-6')?.extendedContextModelId)
      .toBe('claude-opus-4-6[1m]');
  });
});
