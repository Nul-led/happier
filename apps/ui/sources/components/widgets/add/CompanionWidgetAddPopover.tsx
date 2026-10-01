import * as React from 'react';
import type { View } from 'react-native';

import type {
    SessionCompanionBuiltinItemId,
    SessionCompanionItemRefV1,
} from '@/components/sessions/companion/state/sessionCompanionPreference';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { selectWidgetCandidates, type WidgetCandidate } from '@/components/widgets/widgetCatalog';
import type { PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';
import type { SessionBoardSnapshot } from '@/sync/domains/session/board';
import { t } from '@/text';

import { SessionBoardDeclarativeContent } from '@/components/sessions/board/SessionBoardDeclarativeContent';

import { WidgetAddPopover } from './WidgetAddPopover';
import { buildCompanionWidgetAddSections } from './widgetAddSections';

const NO_CANDIDATES: readonly WidgetCandidate[] = Object.freeze([]);

/** A Board note, drawn inert (no action binding): the same renderer the Board card uses. */
const renderNotePreview = (document: unknown): React.ReactNode => (
    <SessionBoardDeclarativeContent document={document} actionBinding={null} testID="widget-add.note-preview" />
);

/** Everything the Companion's Add popover reads; the Companion keeps references only. */
export type CompanionWidgetAddSource = Readonly<{
    refs: readonly SessionCompanionItemRefV1[];
    snapshot: SessionBoardSnapshot | null;
    pluginProjection: PluginUiProjectionModel | null | undefined;
    /** The Session's plugin runtime: compact plugin glances are offered only while it is current. */
    pluginRuntime?: SessionPluginRuntimeState | null;
    addItem: (ref: SessionCompanionItemRefV1) => void;
    /** A glance's live preview, by built-in id (supplied by the glance owners). */
    renderGlancePreview?: (id: SessionCompanionBuiltinItemId) => React.ReactNode;
}>;

/**
 * Add to Companion (lab `cwidgets` WC3, round 2): the shared Gallery | List popover with the
 * Companion's three sources — Glances (built-ins and plugin views that declare the `companion`
 * placement), what is On this board, and Panes, added as a link row that opens in Details. Every
 * choice is one reference through the Companion's one add path; nothing is created on the Board.
 */
export function CompanionWidgetAddPopover(props: Readonly<{
    open: boolean;
    anchorRef: React.RefObject<View | null>;
    onRequestClose: () => void;
    source: CompanionWidgetAddSource;
    placement?: 'top' | 'bottom';
    testID: string;
}>): React.ReactElement | null {
    if (!props.open) return null;
    return <OpenCompanionWidgetAddPopover {...props} />;
}

function OpenCompanionWidgetAddPopover(props: React.ComponentProps<typeof CompanionWidgetAddPopover>): React.ReactElement {
    const { refs, snapshot, pluginProjection, pluginRuntime, addItem, renderGlancePreview } = props.source;
    const glanceCandidates = React.useMemo(() => (
        pluginRuntime?.phase === 'current' && pluginRuntime.pluginUiProjection
            ? selectWidgetCandidates(pluginRuntime.pluginUiProjection, 'session', undefined, 'companion')
            : NO_CANDIDATES
    ), [pluginRuntime]);

    const sections = React.useMemo(() => buildCompanionWidgetAddSections({
        refs,
        snapshot,
        glanceCandidates,
        pluginProjection,
        addItem,
        ...(renderGlancePreview ? { renderGlancePreview } : {}),
        renderNotePreview,
    }), [addItem, glanceCandidates, pluginProjection, refs, renderGlancePreview, snapshot]);

    return (
        <WidgetAddPopover
            open
            anchorRef={props.anchorRef}
            {...(props.placement ? { placement: props.placement } : {})}
            onRequestClose={props.onRequestClose}
            title={t('widgetAdd.companionTitle')}
            hint={t('widgetAdd.companionHint')}
            searchPlaceholder={t('widgetAdd.searchCompanion')}
            sections={sections}
            testID={props.testID}
        />
    );
}
