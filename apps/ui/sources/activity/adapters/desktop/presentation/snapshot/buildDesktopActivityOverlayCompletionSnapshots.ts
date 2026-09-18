import type { SessionActivityAttention } from '@/activity/attention/activityAttentionTypes';
import type { ActivitySurfaceSessionViewModel } from '@/activity/presentation/activitySurfaceViewModels';
import { isRecentActivityCompletion } from '@/activity/attention/activityCompletionTiming';
import { t } from '@/text';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { createActivitySurfaceSessionTarget } from '@/activity/actions/activitySurfaceTargets';

import { DESKTOP_ACTIVITY_OVERLAY_TURN_COMPLETE_AUTO_DISMISS_MS } from '../../desktopActivityOverlayTiming';
import type { DesktopActivityOverlayCompletionStateSnapshot } from './desktopActivityOverlaySnapshotTypes';

export function buildDesktopActivityOverlayCompletionSnapshots(params: Readonly<{
    candidates: readonly SessionActivityAttention[];
    sessionViewModels: readonly ActivitySurfaceSessionViewModel[];
    nowMs: number;
}>): readonly DesktopActivityOverlayCompletionStateSnapshot[] {
    const candidateByAddress = new Map<string, SessionActivityAttention>();
    for (const candidate of params.candidates) {
        if (candidate.address) candidateByAddress.set(sessionAddressKey(candidate.address), candidate);
    }

    const findCandidate = (viewModel: ActivitySurfaceSessionViewModel) => {
        if (viewModel.serverId) return candidateByAddress.get(sessionAddressKey({
            serverId: viewModel.serverId,
            sessionId: viewModel.sessionId,
        }));
        const matches = params.candidates.filter((candidate) => candidate.sessionId === viewModel.sessionId);
        return matches.length === 1 ? matches[0] : undefined;
    };

    return params.sessionViewModels
        .filter((viewModel) => isRecentActivityCompletion(
            findCandidate(viewModel)?.lastTurnCompletedAt,
            params.nowMs,
        ))
        .map((viewModel) => {
            const candidate = findCandidate(viewModel);
            const serverId = candidate?.address?.serverId
                ?? candidate?.serverId
                ?? viewModel.serverId
                ?? null;

            return {
                sessionId: viewModel.sessionId,
                serverId,
                title: viewModel.title,
                summary: t('notifications.activity.readyFallbackBody'),
                openActionIdentifier: createActivitySurfaceSessionTarget(viewModel.sessionId, serverId),
                variant: 'turn_complete' as const,
                autoDismissMs: DESKTOP_ACTIVITY_OVERLAY_TURN_COMPLETE_AUTO_DISMISS_MS,
                sticky: false,
            };
        });
}
