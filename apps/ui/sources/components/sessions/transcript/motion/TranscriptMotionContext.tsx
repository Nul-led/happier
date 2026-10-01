import * as React from 'react';

import type { TranscriptFreshnessGate } from './transcriptFreshnessGate';

export type TranscriptMotionPreset = 'off' | 'subtle' | 'full';

/** The one reader of a stored transcript motion preset: anything unrecognised is the 'subtle' default. */
export function normalizeTranscriptMotionPreset(value: unknown): TranscriptMotionPreset {
    return value === 'off' || value === 'full' ? value : 'subtle';
}

export type TranscriptMotionConfig = {
    preset: TranscriptMotionPreset;
    freshnessMs: number;
    animateNewItemsEnabled: boolean;
    animateToolExpandCollapseEnabled: boolean;
    animateToolExpandCollapseFreshOnly: boolean;
    animateThinkingEnabled: boolean;
};

export type TranscriptMotionRuntime = {
    gate: TranscriptFreshnessGate;
    config: TranscriptMotionConfig;
};

export const TranscriptMotionContext = React.createContext<TranscriptMotionRuntime | null>(null);

export function useTranscriptMotion(): TranscriptMotionRuntime | null {
    return React.useContext(TranscriptMotionContext);
}
