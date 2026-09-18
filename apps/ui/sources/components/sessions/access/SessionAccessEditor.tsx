import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { SelectionList } from '@/components/ui/selectionList';
import { createDefaultDynamicSectionCache } from '@/components/ui/selectionList/selectionListDynamicSectionCache';
import { t } from '@/text';
import { buildSessionAccessSelectionStep } from './buildSessionAccessSelectionStep';
import type { SessionAccessDirectoryKind, SessionAccessEditorProps } from './sessionAccessEditorTypes';

const styles = StyleSheet.create({ full: { flex: 1, minHeight: 0 }, compact: { minHeight: 0 } });
const noop = () => {};

export function SessionAccessEditor(props: SessionAccessEditorProps): React.ReactElement {
    const { model, actions, presentation, onRequestClose, testID = 'session-access-editor' } = props;
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [directoryKind, setDirectoryKind] = React.useState<SessionAccessDirectoryKind | undefined>();
    // Private candidate rows and action closures must not enter the primitive's process-wide default cache.
    const [dynamicSectionCache] = React.useState(createDefaultDynamicSectionCache);
    // An acknowledged removal deletes the row the selection anchor points at, so
    // the anchor would keep naming an option that no longer exists. Selection
    // moves to the next remaining grant, then the previous one, then the search
    // field. A republished or failed row is still present, so it is left alone.
    const acknowledgedGrants = React.useRef(model.grants);
    React.useEffect(() => {
        const previous = acknowledgedGrants.current;
        acknowledgedGrants.current = model.grants;
        if (previous === model.grants || expanded === null) return;
        const removedIndex = previous.findIndex((row) => row.principal.key === expanded);
        if (removedIndex < 0) return;
        const retained = new Set(model.grants.map((row) => row.principal.key));
        if (retained.has(expanded)) return;
        const next = previous.slice(removedIndex + 1).find((row) => retained.has(row.principal.key));
        const before = previous.slice(0, removedIndex).reverse().find((row) => retained.has(row.principal.key));
        setExpanded(next?.principal.key ?? before?.principal.key ?? null);
        announceAccessibilityMessage(t('session.access.removedAnnouncement', {
            name: previous[removedIndex]!.principal.displayName,
        }));
    }, [expanded, model.grants]);
    const input = { model, actions, onExpand: setExpanded, testID,
        ...(props.onOpenFullSurface ? { onOpenFullSurface: props.onOpenFullSurface } : {}) };
    const rootStep = buildSessionAccessSelectionStep(input);
    const source = directoryKind && model.directory.sections.find((section) => section.kind === directoryKind);
    const activeStep = directoryKind ? buildSessionAccessSelectionStep({ ...input, directoryKind }) : null;
    return <View testID={testID} style={presentation === 'full' ? styles.full : styles.compact}>
        <SelectionList rootStep={rootStep} syncActiveStep={activeStep}
            onActiveStepChange={(step) => {
                const kind = model.directory.sections.find((section) => step.id === `session-access-directory:${section.kind}`)?.kind;
                setDirectoryKind(kind);
            }}
            inputValue={model.directory.query} onChangeInputValue={actions.setQuery}
            selectedOptionId={expanded} onSelect={noop} onRequestClose={onRequestClose ?? noop}
            optionsHostInlineControls dynamicSectionCache={dynamicSectionCache}
            listAccessibilityLabel={t('session.access.title')} testID={`${testID}:list`}
            inputTestID={testID === 'session-access-editor' ? 'session-access-search' : `${testID}:session-access-search`}
            autoFocusInputOnWeb={presentation === 'compact'} autoFocusInputOnNative={false}
            fillAvailableSpace={presentation === 'full'} heightBehavior={presentation === 'compact' ? 'stabilizedContentHeight' : 'content'}
            pagination={source ? { hasMore: source.hasMore, loadingMore: source.loadingMore, requestKey: source.cursor,
                error: source.error?.message, onEndReached: () => actions.loadMore(source.kind), onRetry: () => actions.retryDirectory(source.kind),
                loadingLabel: t('common.loading'), moreLabel: t('session.access.browseMore'), retryLabel: t('common.retry'),
                endReachedLabel: t('session.access.allLoaded') } : undefined} />
    </View>;
}
