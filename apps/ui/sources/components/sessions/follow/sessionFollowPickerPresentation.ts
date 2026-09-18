import type { TranslationKey } from '@/text';
import type { SessionListQueryPresentation } from '@/sync/domains/session/listing/sessionListIndexPresentation';

export type SessionFollowPickerPresentation = Readonly<{
    statusKey: TranslationKey | null;
    canSelect: boolean;
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
        return { statusKey: 'sessionsList.queryInitialLoadingTitle', canSelect: false };
    }
    if (presentation.kind === 'refreshing') {
        return { statusKey: 'sessionsList.queryUpdatingTitle', canSelect: hasRows };
    }
    if (presentation.kind === 'partial') {
        return { statusKey: 'sessionsList.querySomeHomesUnavailableTitle', canSelect: hasRows };
    }
    if (presentation.kind === 'error') {
        return { statusKey: 'sessionsList.queryRefreshFailedTitle', canSelect: hasRows };
    }
    if (!presentation.complete) {
        return { statusKey: 'sessionsList.queryMoreAvailableTitle', canSelect: hasRows };
    }
    return { statusKey: null, canSelect: true };
}
