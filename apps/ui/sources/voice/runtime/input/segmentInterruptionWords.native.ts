import { requireOptionalNativeModule } from 'expo-modules-core';

type TextSegmentationModule = Readonly<{ segmentWords: (text: string) => string[] }>;

function wordSegmenter(): TextSegmentationModule {
    // OTA JavaScript cannot add native modules. Resolve only on voice
    // invocation so an older binary can still open the rest of the app.
    const module = requireOptionalNativeModule<TextSegmentationModule>('HappierTextSegmentation');
    if (!module) throw Object.assign(new Error('voice_text_segmentation_unavailable'), { code: 'provider_setup_required' });
    return module;
}

export function ensureInterruptionWordSegmentationAvailable(): void {
    wordSegmenter();
}

/** OS dictionary-backed boundaries; no native voice classification policy. */
export function segmentInterruptionWords(text: string): string[] {
    return wordSegmenter().segmentWords(text);
}
