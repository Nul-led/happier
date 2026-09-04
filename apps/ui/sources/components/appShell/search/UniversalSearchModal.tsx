import * as React from 'react';

import type { CustomModalInjectedProps } from '@/modal/types';
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
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title,
        testID: 'universal-search:modal',
        closeButtonTestID: 'universal-search:close',
        scrollHost: 'body' as const,
        bodyScroll: 'none' as const,
        dimensions: { width: 800, maxHeightRatio: 0.7, size: 'lg' as const },
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
