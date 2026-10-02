import { describe, expect, it } from 'vitest';
import { getKokoroVoiceCatalog, resolveKokoroModelConfig, resolveKokoroVoiceSid } from './kokoro.js';
import type { ModelPackManifest } from './manifest.js';

const manifest: ModelPackManifest = {
  packId: 'kokoro', kind: 'tts_sherpa', model: 'kokoro', version: 'v1.1', files: [],
  frontend: { lang: 'en', lexicon: 'lexicon-en.txt' },
  voices: [{ id: 'first', title: 'First', sid: 2 }, { id: 'second', title: 'Second', sid: 7 }],
  defaultVoiceId: 'second',
};

describe('Kokoro model configuration and voice identity', () => {
  it('preserves the manifest frontend and resolves its explicit default and selected speaker', () => {
    expect(resolveKokoroModelConfig(manifest)).toEqual({ lang: 'en', lexicon: 'lexicon-en.txt' });
    expect(resolveKokoroVoiceSid(manifest, null, 8)).toBe(7);
    expect(resolveKokoroVoiceSid(manifest, 'first', 8)).toBe(2);
    expect(() => resolveKokoroVoiceSid(manifest, 'second', 7)).toThrow('kokoro_voice_unavailable');
    expect(() => resolveKokoroVoiceSid(manifest, 'unknown', 8)).toThrow('kokoro_voice_unavailable');
  });

  it('uses validated numeric speakers for legacy packs without guessing named identities', () => {
    const legacy = { ...manifest, voices: undefined, defaultVoiceId: undefined, frontend: undefined };
    expect(resolveKokoroModelConfig(legacy)).toEqual({ lang: 'en', lexicon: '' });
    expect(getKokoroVoiceCatalog(legacy, 103)).toHaveLength(103);
    expect(resolveKokoroVoiceSid(legacy, 'sid:102', 103)).toBe(102);
    expect(() => resolveKokoroVoiceSid(legacy, 'sid:103', 103)).toThrow('kokoro_voice_unavailable');
    expect(() => resolveKokoroVoiceSid(legacy, 'af_bella', 103)).toThrow('kokoro_voice_unavailable');
    expect(() => resolveKokoroVoiceSid(legacy, 'af_bella', null)).toThrow('kokoro_voice_unavailable');
    expect(resolveKokoroVoiceSid(legacy, 'af_bella', 11)).toBe(1);
    expect(resolveKokoroVoiceSid(legacy, 'sid:10', 11)).toBe(10);
  });
});
