import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { buildWorkBoardItemKeyV1, type BoardItemRefV1, type WorkBoardV1 } from '@happier-dev/protocol';

import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { Icon } from '@/components/ui/icons/Icon';
import { SelectionList, type SelectionListOption, type SelectionListStep } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';
import { useWorkflowDefinitionLibrary, useWorkflowRunWindow } from '@/components/workflows/library/workflowLibraryReads';
import { describeWorkflowRunState } from '@/components/workflows/presentation/workflowLifecyclePresentation';
import { formatWorkflowRunDisplayName, resolveWorkflowRunDisplayName } from '@/components/workflows/presentation/workflowRunDisplayName';
import { Typography } from '@/constants/Typography';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { useMachineListByServerId, useSessionListRowsByServerId } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { getSessionName, getSessionSubtitle } from '@/utils/sessions/sessionUtils';

import type { BoardHomes } from '../model/useBoardContent';

/**
 * Add to board (lab `boards-B5`): one search across kinds, anchored to the header's button. Sessions,
 * workflows, workflow runs and machines, grouped by kind, each with one line of context. An item
 * already on the board says so and is not added twice; ↵ adds it to the first free slot.
 */

const POPOVER_WIDTH_PX = 480;
const POPOVER_MAX_HEIGHT_PX = 560;

export const AddToBoardButton = React.memo(function AddToBoardButton(props: Readonly<{
    board: WorkBoardV1;
    homes: BoardHomes;
    /** Keys of everything on the board now (picked, sections and filter). */
    onBoardKeys: ReadonlySet<string>;
    onAdd: (ref: BoardItemRefV1, options: Readonly<{ place: boolean }>) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}>) {
    const anchorRef = React.useRef<View>(null);
    const { onOpenChange } = props;
    const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
    return (
        <View ref={anchorRef} collapsable={false}>
            <SectionActionButton
                testID="board-header.add"
                title={t('boards.header.add')}
                icon="plus"
                onPress={() => onOpenChange(!props.open)}
            />
            {props.open ? (
                <Popover
                    open
                    anchorRef={anchorRef}
                    placement="bottom"
                    gap={8}
                    edgePadding={{ horizontal: 8, vertical: 8 }}
                    portal={{ web: true, native: true, matchAnchorWidth: false, anchorAlign: 'end' }}
                    maxWidthCap={POPOVER_WIDTH_PX}
                    maxHeightCap={POPOVER_MAX_HEIGHT_PX}
                    onRequestClose={close}
                >
                    {({ maxHeight, maxWidth }) => (
                        <View testID="board-add.popover">
                            <FloatingOverlay
                                maxHeight={Math.min(maxHeight, POPOVER_MAX_HEIGHT_PX)}
                                scrollEnabled={false}
                                surfaceChrome="theme"
                                keyboardShouldPersistTaps="always"
                                containerStyle={{ width: Math.min(maxWidth, POPOVER_WIDTH_PX) }}
                            >
                                <AddToBoardList
                                    homes={props.homes}
                                    onBoardKeys={props.onBoardKeys}
                                    maxHeight={Math.min(maxHeight, POPOVER_MAX_HEIGHT_PX)}
                                    onAdd={(ref, options) => { props.onAdd(ref, options); close(); }}
                                    onRequestClose={close}
                                />
                            </FloatingOverlay>
                        </View>
                    )}
                </Popover>
            ) : null}
        </View>
    );
});

/** Mounted only while the popover is open, so a closed header reads nothing. */
const AddToBoardList = React.memo(function AddToBoardList(props: Readonly<{
    homes: BoardHomes;
    onBoardKeys: ReadonlySet<string>;
    maxHeight: number;
    onAdd: (ref: BoardItemRefV1, options: Readonly<{ place: boolean }>) => void;
    onRequestClose: () => void;
}>) {
    const { theme } = useUnistyles();
    const rowsByServerId = useSessionListRowsByServerId(props.homes.mountedServerIds);
    const machineLists = useMachineListByServerId();
    const library = useWorkflowDefinitionLibrary();
    const runs = useWorkflowRunWindow('all');
    const activeServerId = props.homes.activeServerId;
    const refsRef = React.useRef(new Map<string, BoardItemRefV1>());

    const step = React.useMemo<SelectionListStep>(() => {
        const nowMs = Date.now();
        const refsById = new Map<string, BoardItemRefV1>();
        const onBoardMark = (
            <View style={styles.onBoard}>
                <Icon name="check" size={14} color={theme.colors.text.tertiary} />
                <Text style={styles.onBoardText}>{t('boards.add.onBoard')}</Text>
            </View>
        );
        const option = (ref: BoardItemRefV1, label: string, subtitle: string | undefined, icon: React.ReactNode): SelectionListOption => {
            const key = buildWorkBoardItemKeyV1(ref);
            refsById.set(key, ref);
            const onBoard = props.onBoardKeys.has(key);
            return {
                id: key,
                label,
                ...(subtitle ? { subtitle } : {}),
                icon,
                ...(onBoard ? { rightAccessory: onBoardMark, disabled: true } : {}),
            };
        };
        const glyph = (name: 'chat-circle' | 'tree-structure' | 'clock' | 'hard-drives') => (
            <Icon name={name} size={16} color={theme.colors.text.secondary} />
        );

        const sessions: SelectionListOption[] = [];
        for (const [serverId, rows] of Object.entries(rowsByServerId)) {
            const portable = resolveServerProfileScopeIdForIdentifier(serverId) || serverId;
            for (const row of Object.values(rows ?? {})) {
                if (typeof row.archivedAt === 'number') continue;
                sessions.push(option(
                    { kind: 'session', qualifiedId: { serverId: portable, id: row.id } },
                    getSessionName(row, serverId),
                    getSessionSubtitle(row, serverId),
                    glyph('chat-circle'),
                ));
            }
        }
        const workflows = activeServerId ? library.definitions.map((definition) => option(
            { kind: 'workflow', qualifiedId: { serverId: activeServerId, id: definition.definitionId } },
            definition.metadata.title,
            definition.metadata.description,
            glyph('clock'),
        )) : [];
        const workflowRuns = activeServerId ? runs.rows.flatMap((row) => (row.summary ? [option(
            { kind: 'workflow_run', qualifiedId: { serverId: activeServerId, id: row.id } },
            formatWorkflowRunDisplayName(resolveWorkflowRunDisplayName(row.metadata)),
            `${describeWorkflowRunState(row.summary.state).label} · ${formatRelativeTimeShort(Date.parse(row.summary.createdAt), nowMs)}`,
            glyph('tree-structure'),
        )] : [])) : [];
        const machines: SelectionListOption[] = [];
        for (const [serverId, list] of Object.entries(machineLists)) {
            const portable = resolveServerProfileScopeIdForIdentifier(serverId) || serverId;
            for (const machine of list ?? []) {
                machines.push(option(
                    { kind: 'machine', qualifiedId: { serverId: portable, id: machine.id } },
                    getMachineDisplayName(machine),
                    isMachineOnline(machine, nowMs) ? t('boards.card.machine.online') : t('boards.card.machine.offline'),
                    glyph('hard-drives'),
                ));
            }
        }
        refsRef.current = refsById;
        return {
            id: 'board-add',
            inputPlaceholder: t('boards.add.search'),
            emptyStateLabel: t('boards.add.empty'),
            footerHints: [
                { id: 'add', label: '↵', description: t('boards.add.addHint') },
                { id: 'add-and-place', label: '⌘↵', description: t('boards.add.addAndPlaceHint') },
            ],
            sections: [
                { kind: 'static', id: 'sessions', title: t('boards.add.groups.sessions'), options: sessions, virtualization: 'auto' },
                { kind: 'static', id: 'workflows', title: t('boards.add.groups.workflows'), options: workflows },
                { kind: 'static', id: 'runs', title: t('boards.add.groups.runs'), options: workflowRuns },
                { kind: 'static', id: 'machines', title: t('boards.add.groups.machines'), options: machines },
            ],
        };
    }, [activeServerId, library.definitions, machineLists, props.onBoardKeys, rowsByServerId, runs.rows, theme.colors.text.secondary, theme.colors.text.tertiary]);
    const { onAdd } = props;
    const onSelect = React.useCallback((id: string) => {
        const ref = refsRef.current.get(id);
        if (ref) onAdd(ref, { place: false });
    }, [onAdd]);
    // ⌘↵ / Ctrl+↵: add it and place it on the Canvas.
    const onCommandSelect = React.useCallback((id: string) => {
        const ref = refsRef.current.get(id);
        if (ref) onAdd(ref, { place: true });
    }, [onAdd]);

    return (
        <SelectionList
            testID="board-add.list"
            rootStep={step}
            listAccessibilityLabel={t('boards.add.title')}
            autoFocusInputOnWeb
            maxHeight={props.maxHeight}
            onSelect={onSelect}
            onCommandSelect={onCommandSelect}
            onRequestClose={props.onRequestClose}
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    onBoard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    onBoardText: {
        ...Typography.rowMeta(),
        color: theme.colors.text.tertiary,
    },
}));
