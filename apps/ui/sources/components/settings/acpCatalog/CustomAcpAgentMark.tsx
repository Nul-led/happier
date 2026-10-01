import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { HappierCollectionListMark } from '@happier-dev/plugin-ui/presentation';

/** The mark of a custom ACP agent: a generic command-line agent, since it has no brand of its own. */
export function CustomAcpAgentMark() {
    const { theme } = useUnistyles();
    return (
        <HappierCollectionListMark>
            <Icon name="hard-drives" size={18} color={theme.colors.text.secondary} />
        </HappierCollectionListMark>
    );
}
