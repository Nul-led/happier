import { describe, expect, it } from 'vitest';

import { PI_PREFLIGHT_SESSION_CONTROLS } from './models.js';

const observation = (models: unknown[]) => JSON.stringify({ type: 'happier-pi-model-catalog', models });

describe('Pi structured preflight model discovery', () => {
  it('preserves friendly names, nested model ids, and model-scoped Thinking support', () => {
    expect(PI_PREFLIGHT_SESSION_CONTROLS.models.parseOutput?.({
      ok: true, stdout: '', exitCode: 0,
      stderr: ['vendor diagnostic', observation([
        { provider: 'openai-codex', id: 'gpt-6-sol', name: 'GPT-6 Sol', reasoning: true },
        { provider: 'openrouter', id: 'meta/muse', name: 'Muse', reasoning: false },
      ])].join('\n'),
    })).toEqual([
      expect.objectContaining({ id: 'openai-codex/gpt-6-sol', name: 'GPT-6 Sol', modelOptions: expect.any(Array) }),
      { id: 'openrouter/meta/muse', name: 'Muse', description: 'openrouter' },
    ]);
  });

  it.each([
    'provider model context max-out thinking images\nopenai stale 200K 4K yes no',
    JSON.stringify({ type: 'happier-pi-model-catalog', error: 'refresh-unsupported' }),
    JSON.stringify({ type: 'happier-pi-model-catalog', error: 'offline' }),
    observation([{ nonsense: true }]),
  ])('does not promote an unrefreshed or invalid catalog: %s', (stderr) => {
    expect(PI_PREFLIGHT_SESSION_CONTROLS.models.parseOutput?.({ ok: true, stdout: '', stderr, exitCode: 0 })).toBeNull();
  });

  it('labels a supported predecessor local snapshot as degraded rather than network-refreshed', () => {
    const stderr = JSON.stringify({ type: 'happier-pi-model-catalog', error: 'refresh-unsupported', models: [
      { provider: 'openai-codex', id: 'gpt-6-sol', name: 'GPT-6 Sol', reasoning: true },
    ] });
    expect(PI_PREFLIGHT_SESSION_CONTROLS.models.parseOutput?.({ ok: true, stdout: '', stderr, exitCode: 0 })).toEqual({
      source: 'static', refreshError: true,
      availableModels: [expect.objectContaining({ id: 'openai-codex/gpt-6-sol', name: 'GPT-6 Sol' })],
    });
  });

  it('preserves a confirmed empty catalog', () => {
    expect(PI_PREFLIGHT_SESSION_CONTROLS.models.parseOutput?.({ ok: true, stdout: '', stderr: observation([]), exitCode: 0 })).toEqual([]);
  });
});
