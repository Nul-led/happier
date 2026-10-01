import * as React from 'react';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

/**
 * The one state an embedded Session shows when it cannot be presented: missing, deleted, out of the
 * mount's scope or not accessible. It never says which, so a mount cannot probe for existence.
 */
export function EmbeddedSessionUnavailable() {
    return (
        <SurfaceStateCard
            testID="embedded-session-unavailable"
            kind="unavailable"
            iconName="chat-circle"
            title={t('session.embedded.unavailable')}
        />
    );
}
