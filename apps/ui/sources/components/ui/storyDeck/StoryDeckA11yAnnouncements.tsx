import * as React from 'react';

import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { t, tLoose } from '@/text';

export type StoryDeckA11yAnnouncementsProps = Readonly<{
    currentIndex: number;
    totalCount: number;
    currentTitleKey: string;
}>;

/**
 * Headless announcer that speaks the active slide whenever it changes, through
 * the canonical polite announcement owner.
 */
export function StoryDeckA11yAnnouncements(props: StoryDeckA11yAnnouncementsProps) {
    const { currentIndex, totalCount, currentTitleKey } = props;

    React.useEffect(() => {
        const title = tLoose(currentTitleKey);
        const message = totalCount > 1
            ? t('releaseNotes.storyDeck.slideAnnouncement', {
                title,
                current: currentIndex + 1,
                total: totalCount,
            })
            : title;

        announceAccessibilityMessage(message);
    }, [currentIndex, totalCount, currentTitleKey]);

    return null;
}
