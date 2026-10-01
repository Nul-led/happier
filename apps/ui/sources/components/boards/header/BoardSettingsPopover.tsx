import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
    normalizeSessionListFilterV1,
    type BoardItemRefV1,
    type WorkBoardIntentV1,
    type WorkBoardSectionV1,
    type WorkBoardV1,
} from '@happier-dev/protocol';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { SelectionCheckGlyph } from '@/components/ui/selection/SelectionCheckGlyph';
import { Modal } from '@/modal';
import { t } from '@/text';

import type { BoardCard } from '../model/boardCards';
import type { BoardHomes } from '../model/useBoardContent';
import { BoardSessionFilterControl } from './BoardSessionFilterControl';

/**
 * Board settings (lab `boards-B4`), from the header's ⋯: the name; what's on the board — smart sections
 * and the Sessions filter, plus what was added by hand (each removable); the layout; snapping; the pin
 * in the Sessions list (per board, off by default); and Delete board, last.
 */

const POPOVER_WIDTH_PX = 400;
const POPOVER_MAX_HEIGHT_PX = 640;
const SECTIONS: readonly WorkBoardSectionV1[] = ['needs_you', 'running', 'my_machines'];

export const BoardSettingsButton = React.memo(function BoardSettingsButton(props: Readonly<{
    board: WorkBoardV1;
    homes: BoardHomes;
    pickedCards: readonly BoardCard[];
    canvasAvailable: boolean;
    dispatch: (intent: WorkBoardIntentV1) => void;
    /** Removes a pick with the board's live membership, so an item a section still holds keeps its place. */
    onRemoveItem: (ref: BoardItemRefV1) => void;
    onDeleted: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAddByHand: () => void;
}>) {
    const anchorRef = React.useRef<View>(null);
    const { onOpenChange } = props;
    const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
    return (
        <View ref={anchorRef} collapsable={false}>
            <IconButton
                testID="board-header.settings"
                iconName="dots-three"
                variant="plain"
                accessibilityLabel={t('boards.header.settings')}
                tooltip={t('boards.header.settings')}
                onPress={() => onOpenChange(!props.open)}
            />
            {props.open ? (
                <Popover
                    open
                    anchorRef={anchorRef}
                    autoFocusOnOpen
                    placement="bottom"
                    gap={8}
                    edgePadding={{ horizontal: 8, vertical: 8 }}
                    portal={{ web: true, native: true, matchAnchorWidth: false, anchorAlign: 'end' }}
                    maxWidthCap={POPOVER_WIDTH_PX}
                    maxHeightCap={POPOVER_MAX_HEIGHT_PX}
                    onRequestClose={close}
                >
                    {({ maxHeight, maxWidth }) => (
                        <View testID="board-settings.popover">
                            <FloatingOverlay
                                maxHeight={Math.min(maxHeight, POPOVER_MAX_HEIGHT_PX)}
                                edgeFades={{ top: true, bottom: true, size: 18 }}
                                surfaceChrome="theme"
                                keyboardShouldPersistTaps="always"
                                containerStyle={{ width: Math.min(maxWidth, POPOVER_WIDTH_PX) }}
                            >
                                <BoardSettingsContent
                                    board={props.board}
                                    homes={props.homes}
                                    pickedCards={props.pickedCards}
                                    canvasAvailable={props.canvasAvailable}
                                    dispatch={props.dispatch}
                                    onRemoveItem={props.onRemoveItem}
                                    onAddByHand={() => { close(); props.onAddByHand(); }}
                                    onDelete={async () => {
                                        const confirmed = await Modal.confirm(
                                            t('boards.settings.deleteConfirmTitle'),
                                            t('boards.settings.deleteConfirmBody'),
                                            { confirmText: t('boards.settings.delete'), destructive: true },
                                        );
                                        if (!confirmed) return;
                                        close();
                                        props.dispatch({ kind: 'delete', boardId: props.board.id });
                                        props.onDeleted();
                                    }}
                                />
                            </FloatingOverlay>
                        </View>
                    )}
                </Popover>
            ) : null}
        </View>
    );
});

const BoardSettingsContent = React.memo(function BoardSettingsContent(props: Readonly<{
    board: WorkBoardV1;
    homes: BoardHomes;
    pickedCards: readonly BoardCard[];
    canvasAvailable: boolean;
    dispatch: (intent: WorkBoardIntentV1) => void;
    onRemoveItem: (ref: BoardItemRefV1) => void;
    onAddByHand: () => void;
    onDelete: () => void;
}>) {
    const { board, dispatch } = props;
    const [name, setName] = React.useState(board.name);
    const commitName = () => {
        const next = name.trim();
        if (next && next !== board.name) dispatch({ kind: 'update', boardId: board.id, patch: { name: next } });
        else setName(board.name);
    };
    const sections = new Set(board.source.sections ?? []);
    const setSource = (next: Readonly<{ sections: readonly WorkBoardSectionV1[]; filter: boolean }>) => dispatch({
        kind: 'update',
        boardId: board.id,
        patch: {
            source: {
                ...(next.sections.length > 0 ? { sections: next.sections } : {}),
                // "All active sessions" is the default inline filter.
                ...(next.filter ? { filter: board.source.filter ?? normalizeSessionListFilterV1() } : {}),
            },
        },
    });
    const toggleSection = (section: WorkBoardSectionV1) => setSource({
        sections: SECTIONS.filter((candidate) => (candidate === section ? !sections.has(candidate) : sections.has(candidate))),
        filter: board.source.filter !== undefined,
    });
    const toggleFilter = () => setSource({ sections: [...sections], filter: board.source.filter === undefined });

    return (
        <View style={styles.content}>
            <ItemGroup title={t('boards.settings.title')}>
                <View style={styles.field}>
                    <FieldItem label={t('boards.settings.name')}>
                        <FieldTextInput
                            testID="board-settings.name"
                            value={name}
                            onChangeText={setName}
                            accessibilityLabel={t('boards.settings.name')}
                            returnKeyType="done"
                            onSubmitEditing={commitName}
                            onBlur={commitName}
                        />
                    </FieldItem>
                </View>
            </ItemGroup>
            <ItemGroup title={t('boards.settings.whatsOn')}>
                {SECTIONS.map((section) => (
                    <Item
                        key={section}
                        testID={`board-settings.section.${section}`}
                        title={t(`boards.sections.${section}.title`)}
                        subtitle={t(`boards.sections.${section}.description`)}
                        leftElement={<SelectionCheckGlyph state={sections.has(section) ? 'checked' : 'unchecked'} />}
                        accessibilityRole="checkbox"
                        accessibilityChecked={sections.has(section)}
                        showChevron={false}
                        onPress={() => toggleSection(section)}
                    />
                ))}
                <Item
                    testID="board-settings.section.filter"
                    title={t('boards.sections.filter.title')}
                    subtitle={t('boards.sections.filter.description')}
                    leftElement={<SelectionCheckGlyph state={board.source.filter ? 'checked' : 'unchecked'} />}
                    accessibilityRole="checkbox"
                    accessibilityChecked={board.source.filter !== undefined}
                    showChevron={false}
                    onPress={toggleFilter}
                />
                {board.source.filter ? (
                    <Item
                        testID="board-settings.filter"
                        title={t('boards.settings.whichSessions')}
                        showChevron={false}
                        mode="info"
                        accessoryLayout="adaptive"
                        rightElement={(
                            <BoardSessionFilterControl
                                board={board}
                                filter={board.source.filter}
                                homes={props.homes}
                                dispatch={dispatch}
                            />
                        )}
                    />
                ) : null}
            </ItemGroup>
            <ItemGroup
                title={t('boards.settings.addedByHand')}
                action={<IconButton testID="board-settings.add" iconName="plus" variant="plain" accessibilityLabel={t('boards.settings.add')} onPress={props.onAddByHand} />}
            >
                {props.pickedCards.length === 0 ? (
                    <Item title={t('boards.settings.addedByHandNone')} mode="info" showChevron={false} />
                ) : props.pickedCards.map((card) => (
                    <Item
                        key={card.key}
                        testID={`board-settings.picked.${card.key}`}
                        title={card.title}
                        subtitle={t(`boards.kinds.${card.ref.kind}`)}
                        showChevron={false}
                        mode="info"
                        rightElementOutsidePressable
                        rightElement={(
                            <IconButton
                                testID={`board-settings.remove.${card.key}`}
                                iconName="x"
                                variant="plain"
                                accessibilityLabel={t('boards.card.remove')}
                                tooltip={t('boards.card.remove')}
                                onPress={() => props.onRemoveItem(card.ref)}
                            />
                        )}
                    />
                ))}
            </ItemGroup>
            <ItemGroup>
                {props.canvasAvailable ? (
                    <Item
                        title={t('boards.settings.layout')}
                        subtitle={t('boards.settings.layoutDescription')}
                        showChevron={false}
                        mode="info"
                        accessoryLayout="adaptive"
                        rightElement={(
                            <SegmentedTabBar
                                testIDPrefix="board-settings.layout"
                                accessibilityLabel={t('boards.header.layoutA11y')}
                                compact
                                segmentSizing="content"
                                tabs={[
                                    { id: 'canvas' as const, label: t('boards.header.canvas') },
                                    { id: 'by_status' as const, label: t('boards.header.byStatus') },
                                ]}
                                activeTabId={board.mode}
                                onSelectTab={(mode) => dispatch({ kind: 'update', boardId: board.id, patch: { mode } })}
                            />
                        )}
                    />
                ) : null}
                <Item
                    title={t('boards.settings.snap')}
                    showChevron={false}
                    mode="info"
                    rightElement={(
                        <Switch
                            testID="board-settings.snap"
                            value={board.snap}
                            onValueChange={(snap) => dispatch({ kind: 'update', boardId: board.id, patch: { snap } })}
                        />
                    )}
                />
                <Item
                    title={t('boards.settings.pin')}
                    subtitle={t('boards.settings.pinDescription')}
                    showChevron={false}
                    mode="info"
                    rightElement={(
                        <Switch
                            testID="board-settings.pin"
                            value={board.pinnedInSessions}
                            onValueChange={(pinnedInSessions) => dispatch({ kind: 'update', boardId: board.id, patch: { pinnedInSessions } })}
                        />
                    )}
                />
            </ItemGroup>
            <ItemGroup>
                <Item
                    testID="board-settings.delete"
                    title={t('boards.settings.delete')}
                    destructive
                    showChevron={false}
                    onPress={props.onDelete}
                />
            </ItemGroup>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    content: {
        paddingVertical: 8,
    },
    field: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
}));
