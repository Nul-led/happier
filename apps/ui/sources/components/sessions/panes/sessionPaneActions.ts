import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionScmReviewDetailsTab, SESSION_DETAILS_SCM_REVIEW_TAB_KEY } from './details/sessionDetailsTabBuilders';

export function toggleSessionReview(pane: Pick<AppPaneScopeApi, 'scopeState' | 'openDetailsTab' | 'closeDetails'>) {
    if (pane.scopeState?.details.isOpen && pane.scopeState.details.activeTabKey === SESSION_DETAILS_SCM_REVIEW_TAB_KEY) {
        pane.closeDetails();
    } else {
        pane.openDetailsTab(createSessionScmReviewDetailsTab(), { intent: 'pinned' });
    }
}
