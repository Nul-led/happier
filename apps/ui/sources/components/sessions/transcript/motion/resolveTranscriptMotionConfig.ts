import {
    normalizeTranscriptMotionPreset,
    type TranscriptMotionConfig,
    type TranscriptMotionPreset,
} from './TranscriptMotionContext';

export function resolveTranscriptMotionConfig(input: {
    reducedMotionPreferred?: unknown;
    transcriptMotionPreset?: unknown;
    transcriptMotionFreshnessMs?: unknown;
    transcriptAnimateNewItemsEnabled?: unknown;
    transcriptAnimateToolExpandCollapseEnabled?: unknown;
    transcriptAnimateToolExpandCollapseFreshOnly?: unknown;
    transcriptAnimateThinkingEnabled?: unknown;
}): TranscriptMotionConfig {
    const reducedMotionPreferred = input.reducedMotionPreferred === true;

    const preset: TranscriptMotionPreset = reducedMotionPreferred
        ? 'off'
        : normalizeTranscriptMotionPreset(input.transcriptMotionPreset);

    const freshnessMs =
        typeof input.transcriptMotionFreshnessMs === 'number' && Number.isFinite(input.transcriptMotionFreshnessMs)
            ? Math.max(0, Math.trunc(input.transcriptMotionFreshnessMs))
            : 60_000;

    return {
        preset,
        freshnessMs,
        animateNewItemsEnabled: !reducedMotionPreferred && input.transcriptAnimateNewItemsEnabled !== false,
        animateToolExpandCollapseEnabled: !reducedMotionPreferred && input.transcriptAnimateToolExpandCollapseEnabled !== false,
        animateToolExpandCollapseFreshOnly: !reducedMotionPreferred && input.transcriptAnimateToolExpandCollapseFreshOnly !== false,
        animateThinkingEnabled: !reducedMotionPreferred && input.transcriptAnimateThinkingEnabled !== false,
    };
}
