import * as React from 'react';

import type { CustomModalInjectedProps } from '@/modal/types';
import { buildCommandSurfaceCardChrome } from '@/modal/components/card/commandSurfaceCard';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import type { Command } from '@/components/appShell/commandPalette/types';
import { t } from '@/text';
import { UniversalSearchController } from './UniversalSearchController';
import type { UniversalSearchScopeSeed } from './UniversalSearchRuntimeContext';

export type UniversalSearchModalProps = CustomModalInjectedProps & Readonly<{
    commands: readonly Command[];
    initialQuery?: string;
    activeSessionId?: string | null;
    initialScope?: UniversalSearchScopeSeed;
}>;

export function UniversalSearchModal(props: UniversalSearchModalProps): React.ReactElement {
    const title = t('tools.names.search');
    // Spotlight: the command-surface card, with the search field as its top. Esc and the backdrop close it.
    const chrome = React.useMemo(() => buildCommandSurfaceCardChrome({
        title,
        testID: 'universal-search:modal',
        closeButtonTestID: 'universal-search:close',
    }), [title]);
    useModalCardChrome(props.setChrome, chrome);
    return (
        <UniversalSearchController
            commands={props.commands}
            initialQuery={props.initialQuery}
            activeSessionId={props.activeSessionId}
            initialScope={props.initialScope}
            presentation="modal"
            onRequestClose={props.onClose}
        />
    );
}
