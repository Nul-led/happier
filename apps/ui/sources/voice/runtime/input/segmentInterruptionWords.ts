type WordSegmenter = Readonly<{
    segment: (text: string) => Iterable<Readonly<{ segment: string }>>;
}>;
type WordSegmenterConstructor = new (locale?: string, options?: Readonly<{ granularity: 'word' }>) => WordSegmenter;

function wordSegmenter(): WordSegmenter {
    // ES2022's type library predates Segmenter; keep the platform API seam
    // narrow rather than widening the package's language target.
    const Constructor = (Intl as typeof Intl & { Segmenter?: WordSegmenterConstructor }).Segmenter;
    if (!Constructor) throw Object.assign(new Error('voice_text_segmentation_unavailable'), { code: 'provider_setup_required' });
    return new Constructor(undefined, { granularity: 'word' });
}

export function ensureInterruptionWordSegmentationAvailable(): void {
    wordSegmenter();
}

/** Platform word boundaries only; the transcript owner filters meaning. */
export function segmentInterruptionWords(text: string): string[] {
    return Array.from(wordSegmenter().segment(text), (part) => part.segment);
}
