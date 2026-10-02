import type { ModelPackManifest, ModelPackVoiceCatalogEntry } from './manifest.js';

export type KokoroModelConfig = Readonly<{ lang: string; lexicon: string }>;

/** Missing metadata retains the existing English sherpa frontend contract. */
export function resolveKokoroModelConfig(manifest: ModelPackManifest): KokoroModelConfig {
  return { lang: manifest.frontend?.lang ?? 'en', lexicon: manifest.frontend?.lexicon ?? '' };
}

// Predecessor v0.19 manifests omitted voices. Preserve only this verified
// 11-speaker family; never guess a named identity from an unknown model.
const LEGACY_V0_19_VOICES = [
  'af', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam',
  'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis',
] as const;

export function getKokoroVoiceCatalog(
  manifest: Pick<ModelPackManifest, 'voices'>,
  speakerCount?: number | null,
): readonly ModelPackVoiceCatalogEntry[] {
  if (manifest.voices?.length) return manifest.voices;
  if (!Number.isInteger(speakerCount) || !speakerCount || speakerCount < 1) return [];
  return Array.from({ length: speakerCount }, (_, sid) => ({
    id: speakerCount === LEGACY_V0_19_VOICES.length ? LEGACY_V0_19_VOICES[sid]! : `sid:${sid}`,
    title: speakerCount === LEGACY_V0_19_VOICES.length ? LEGACY_V0_19_VOICES[sid]! : `Speaker ${sid}`,
    sid,
  }));
}

/** One speaker-identity decision for daemon and both native platforms. */
export function resolveKokoroVoiceSid(
  manifest: Pick<ModelPackManifest, 'voices' | 'defaultVoiceId'>,
  voiceId: string | null | undefined,
  speakerCount?: number | null,
): number {
  const catalog = getKokoroVoiceCatalog(manifest, speakerCount);
  const requested = voiceId?.trim() || manifest.defaultVoiceId || catalog[0]?.id;
  const declared = catalog.find((voice) => voice.id === requested);
  let sid = declared?.sid;
  if (!manifest.voices?.length && requested && /^sid:(0|[1-9]\d*)$/.test(requested)) {
    sid = Number(requested.slice(4));
  }
  if (
    sid === undefined || !Number.isSafeInteger(sid) || sid < 0
    || (speakerCount != null && (!Number.isInteger(speakerCount) || sid >= speakerCount))
    || (!manifest.voices?.length && speakerCount == null)
  ) throw new Error('kokoro_voice_unavailable');
  return sid;
}
