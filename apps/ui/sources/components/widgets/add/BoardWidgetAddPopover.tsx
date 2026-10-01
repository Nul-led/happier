import * as React from 'react';
import type { View } from 'react-native';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import type { SessionBoardController } from '@/components/sessions/board/useSessionBoardController';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { InstalledWidgetSurface } from '@/components/widgets/InstalledWidgetSurface';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

import { WidgetAddPopover } from './WidgetAddPopover';
import { buildBoardWidgetAddContent } from './widgetAddSections';

const PLUGINS_ROUTE = '/plugins';

/**
 * The Board's Add popover: the shared Gallery | List popover filled with what this Board can add
 * (`buildBoardWidgetAddContent`). Mounted only while open, so nothing here reads or previews while
 * it is closed.
 */
export function BoardWidgetAddPopover(props: Readonly<{
    open: boolean;
    anchorRef: React.RefObject<View | null>;
    onRequestClose: () => void;
    controller: SessionBoardController;
    sessionId: string;
    session?: Session;
    /** The Board's current-Session widget candidates (the one executable creation projection). */
    candidates: readonly WidgetCandidate[];
    pluginRuntime?: SessionPluginRuntimeState;
    placement?: 'top' | 'bottom';
    testID: string;
}>): React.ReactElement | null {
    if (!props.open) return null;
    return <OpenBoardWidgetAddPopover {...props} />;
}

function OpenBoardWidgetAddPopover(props: React.ComponentProps<typeof BoardWidgetAddPopover>): React.ReactElement {
    const router = useRouter();
    const { controller, candidates, pluginRuntime, sessionId, session, testID } = props;
    const intents = controller.addIntents;
    const snapshot = controller.snapshot;
    const run = controller.run;
    const content = React.useMemo(() => buildBoardWidgetAddContent({
        intents,
        candidates,
        snapshot,
        run,
        ...(pluginRuntime ? {
            // The real widget body with this Session's data, at the Board's placement.
            renderPluginPreview: (candidate: WidgetCandidate) => (
                <InstalledWidgetSurface
                    testID={`${testID}.preview.${candidate.key}`}
                    target={{ kind: 'session', sessionId, ...(session ? { session } : {}) }}
                    recordRevision={`add-preview:${candidate.key}`}
                    source={{ kind: 'installedSurface', surface: candidate.surface }}
                    presentation="content"
                    placement="board"
                    runtime={pluginRuntime}
                />
            ),
        } : {}),
        openPlugins: () => { router.push(PLUGINS_ROUTE as never); },
    }), [candidates, intents, pluginRuntime, router, run, session, sessionId, snapshot, testID]);

    return (
        <WidgetAddPopover
            open
            anchorRef={props.anchorRef}
            {...(props.placement ? { placement: props.placement } : {})}
            onRequestClose={props.onRequestClose}
            title={t('widgetAdd.boardTitle')}
            hint={t('widgetAdd.boardHint')}
            searchPlaceholder={t('widgetAdd.searchWidgets')}
            sections={content.sections}
            {...(content.ask ? { ask: content.ask } : {})}
            testID={testID}
        />
    );
}
