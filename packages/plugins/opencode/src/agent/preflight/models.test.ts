import { describe, expect, it } from 'vitest';

import {
  buildOpenCodePreflightModelsFromVerboseOutput,
  OPENCODE_PREFLIGHT_SESSION_CONTROLS,
} from './models.js';

describe('OpenCode preflight model parsing', () => {
  it('retains provider-native model metadata from verbose output', () => {
    expect(buildOpenCodePreflightModelsFromVerboseOutput([
      'openai/gpt-5.4',
      '{',
      '  "id": "gpt-5.4",',
      '  "name": "GPT-5.4",',
      '  "providerID": "openai",',
      '  "status": "active",',
      '  "capabilities": { "toolcall": true, "input": { "text": true }, "reasoning": true },',
      '  "variants": { "medium": {}, "high": {} }',
      '}',
    ].join('\n'))).toEqual([
      expect.objectContaining({ id: 'openai/gpt-5.4', name: 'GPT-5.4' }),
    ]);
  });

  it('retains nested OpenRouter model ids from verbose and plain output', () => {
    const verboseOutput = [
      'opencode/gpt-5',
      '{"id":"gpt-5","providerID":"opencode","name":"GPT-5","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/deepseek/deepseek-v4-flash-0731',
      '{"id":"deepseek/deepseek-v4-flash-0731","providerID":"openrouter","name":"DeepSeek V4 Flash","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/~anthropic/claude-opus-latest',
      '{"id":"~anthropic/claude-opus-latest","providerID":"openrouter","name":"Claude Opus Latest","status":"active","capabilities":{"toolcall":true}}',
    ].join('\n');

    expect(buildOpenCodePreflightModelsFromVerboseOutput(verboseOutput)).toEqual([
      { id: 'opencode/gpt-5', name: 'GPT-5', description: 'opencode' },
      {
        id: 'openrouter/deepseek/deepseek-v4-flash-0731',
        name: 'DeepSeek V4 Flash',
        description: 'openrouter',
      },
      {
        id: 'openrouter/~anthropic/claude-opus-latest',
        name: 'Claude Opus Latest',
        description: 'openrouter',
      },
    ]);

    expect(OPENCODE_PREFLIGHT_SESSION_CONTROLS.models?.fallback?.parseOutput?.({
      ok: true,
      stdout: [
        'opencode/gpt-5',
        'openrouter/deepseek/deepseek-v4-flash-0731',
        'openrouter/~anthropic/claude-opus-latest',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })).toEqual([
      { id: 'opencode/gpt-5', name: 'opencode/gpt-5' },
      {
        id: 'openrouter/deepseek/deepseek-v4-flash-0731',
        name: 'openrouter/deepseek/deepseek-v4-flash-0731',
      },
      {
        id: 'openrouter/~anthropic/claude-opus-latest',
        name: 'openrouter/~anthropic/claude-opus-latest',
      },
    ]);
  });

  it('rejects a partial verbose inventory when a header disagrees with its record identity', () => {
    expect(buildOpenCodePreflightModelsFromVerboseOutput([
      'opencode/gpt-5',
      '{"id":"gpt-5","providerID":"opencode","name":"GPT-5","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/incorrect/model-id',
      '{"id":"deepseek/deepseek-v4-flash-0731","providerID":"openrouter","name":"DeepSeek V4 Flash","status":"active","capabilities":{"toolcall":true}}',
    ].join('\n'))).toBeNull();
  });

  it('declares verbose then plain native commands without a plugin timeout or auth policy', () => {
    const models = OPENCODE_PREFLIGHT_SESSION_CONTROLS.models;
    expect(models?.command).toEqual({ toolId: 'opencode-cli', args: ['models', '--verbose'] });
    expect(models?.fallback?.command).toEqual({ toolId: 'opencode-cli', args: ['models'] });
    expect(OPENCODE_PREFLIGHT_SESSION_CONTROLS).not.toHaveProperty('failureCacheStrategy');
    expect(OPENCODE_PREFLIGHT_SESSION_CONTROLS).not.toHaveProperty('connectedServiceAuth');
  });

  it('lets the host select the fallback after an unparsable verbose result', () => {
    const models = OPENCODE_PREFLIGHT_SESSION_CONTROLS.models;
    expect(models?.parseOutput?.({
      ok: true,
      stdout: 'not verbose model output',
      stderr: '',
      exitCode: 0,
    })).toBeNull();
    expect(models?.fallback?.parseOutput?.({
      ok: true,
      stdout: 'openai/gpt-5.4\nanthropic/claude-opus-5\n',
      stderr: '',
      exitCode: 0,
    })).toEqual([
      { id: 'openai/gpt-5.4', name: 'openai/gpt-5.4' },
      { id: 'anthropic/claude-opus-5', name: 'anthropic/claude-opus-5' },
    ]);
  });
});
