import type { TranslationKey } from '@/text';
import type { SessionListQueryPresentation } from '@/sync/domains/session/listing/sessionListIndexPresentation';

export type SessionFollowPickerPresentation = Readonly<{
    statusKey: TranslationKey | null;
    canSelect: boolean;
    /**
     * Whether re-running the discovery query is the action this state owes. A failed or partially
     * unavailable corpus is not self-healing here — the picker only advances the query while it is
     * `ready` — so the person needs a way to ask for it again.
     */
    canRetryQuery: boolean;
}>;

export function buildSessionFollowPickerContextTitle(input: Readonly<{
    actionTitle: string;
    sessionTitle: string | null;
    homeName: string | null;
}>): string {
    return [input.actionTitle, input.sessionTitle?.trim(), input.homeName?.trim()]
        .filter((part): part is string => Boolean(part))
        .join(' · ');
}

export function resolveSessionFollowPickerPresentation(
    presentation: SessionListQueryPresentation,
    visibleRowCount: number,
): SessionFollowPickerPresentation {
    const hasRows = visibleRowCount > 0;
    if (presentation.kind === 'initial_loading') {
        return { statusKey: 'sessionsList.queryInitialLoadingTitle', canSelect: false, canRetryQuery: false };
    }
    if (presentation.kind === 'refreshing') {
        return { statusKey: 'sessionsList.queryUpdatingTitle', canSelect: hasRows, canRetryQuery: false };
    }
    if (presentation.kind === 'partial') {
        return { statusKey: 'sessionsList.querySomeHomesUnavailableTitle', canSelect: hasRows, canRetryQuery: true };
    }
    if (presentation.kind === 'error') {
        return { statusKey: 'sessionsList.queryRefreshFailedTitle', canSelect: hasRows, canRetryQuery: true };
    }
    if (!presentation.complete) {
        return { statusKey: 'sessionsList.queryMoreAvailableTitle', canSelect: hasRows, canRetryQuery: false };
    }
    return { statusKey: null, canSelect: true, canRetryQuery: false };
}
