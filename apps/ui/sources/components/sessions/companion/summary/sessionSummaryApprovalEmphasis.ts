import { motionTokens } from '@/components/ui/motion/motionTokens';

/** Initial hydration and approval completion are deliberately quiet. */
export function shouldEmphasizeNewSessionSummaryApproval(
    previousOpenCount: number | null,
    currentOpenCount: number,
): boolean {
    return previousOpenCount !== null && currentOpenCount > previousOpenCount;
}

export function resolveSessionSummaryApprovalEmphasisMotion(
    reducedMotion: boolean,
): Readonly<{ initialOpacity: number; durationMs: number }> {
    return reducedMotion
        ? { initialOpacity: 1, durationMs: 0 }
        : { initialOpacity: 0.72, durationMs: motionTokens.durationMs.base };
}
