import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { ScmFileStatus } from '@/scm/scmStatusFiles';
import { describeScmChangeKind, resolveScmChangeToneColor } from '@/scm/scmChangeKind';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';
import { InlineRepoPathLabel } from '@/components/ui/path/InlineRepoPathLabel';
import { useIsActiveReviewFile } from '@/components/workspaces/scm/review/activeReviewFile';
import { TREE_ROW_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { isTouchPrimaryPointer } from '@/components/ui/interactiveTargetSize';
import { ScmChangeMark } from './ScmChangeMark';
const PATH_SEPARATOR = '/';
const CHANGE_STATS_MIN_COLUMN_WIDTH = 38;
const CHANGE_STATS_CHARACTER_WIDTH = 7;
const CHANGE_STATS_COLUMN_EXTRA_WIDTH = 4;

type Theme = Readonly<{
    colors: Readonly<{
        surface?: Readonly<{
            base?: string;
            inset?: string;
        }>;
        border?: Readonly<{
            default?: string;
        }>;
        text: Readonly<{
            primary?: string;
            secondary: string;
            link?: string;
        }>;
        state: Readonly<{
            success: Readonly<{ foreground?: string }>;
            neutral: Readonly<{ foreground?: string }>;
            danger: Readonly<{ foreground?: string }>;
        }>;
    }>;
}>;

const ViewWithClick = View as unknown as React.ComponentType<
    React.ComponentPropsWithRef<typeof View> & {
        onClick?: any;
        onDoubleClick?: any;
        tabIndex?: number;
        onKeyDown?: any;
        onMouseEnter?: () => void;
        onMouseLeave?: () => void;
        onFocus?: () => void;
        onBlur?: () => void;
    }
>;

/** The stacked (name over folder) row is 44 tall at the default text size: two lines plus this inset. */
const STACKED_ROW_PADDING_VERTICAL_PX = 6;
/**
 * The compact (name, then folder, on one line) row takes the tree row's rhythm (Git lab TV): 28 under a
 * precise pointer, 36 under a finger, no gap between rows — so the list and the tree read alike.
 */
function resolveCompactRowMinHeight(): number {
    return isTouchPrimaryPointer() ? TREE_ROW_METRICS.minHeightPx.touch : TREE_ROW_METRICS.minHeightPx.precise;
}

type ChangeDescriptor = Readonly<{
    code: string;
    color: string;
    label: string;
}>;

type ScmChangeStatsLike = Readonly<{
    linesAdded?: number | null;
    linesRemoved?: number | null;
}>;

function normalizeLineCount(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value)
        ? String(Math.max(0, Math.trunc(value)))
        : '0';
}

export function resolveScmChangeStatsColumnWidth(files: readonly ScmChangeStatsLike[]): number {
    let maxLabelLength = 0;
    for (const file of files) {
        const added = normalizeLineCount(file.linesAdded);
        const removed = normalizeLineCount(file.linesRemoved);
        maxLabelLength = Math.max(maxLabelLength, `+${added}${PATH_SEPARATOR}-${removed}`.length);
    }
    return Math.max(
        CHANGE_STATS_MIN_COLUMN_WIDTH,
        maxLabelLength * CHANGE_STATS_CHARACTER_WIDTH + CHANGE_STATS_COLUMN_EXTRA_WIDTH,
    );
}

const CHANGE_LABEL_KEYS = {
    modified: 'files.changeRow.status.modified',
    added: 'files.changeRow.status.added',
    untracked: 'files.changeRow.status.untracked',
    deleted: 'files.changeRow.status.deleted',
    renamed: 'files.changeRow.status.renamed',
    copied: 'files.changeRow.status.copied',
    conflicted: 'files.changeRow.status.conflicted',
} as const satisfies Record<ScmFileStatus['status'], string>;

/** The letter and tone come from the one change-kind owner, so Git rows and the Files tree agree. */
function describeChange(file: ScmFileStatus, theme: Theme): ChangeDescriptor {
    const { code, tone } = describeScmChangeKind(file.status);
    return {
        code,
        color: resolveScmChangeToneColor(tone, theme),
        label: t(CHANGE_LABEL_KEYS[file.status] ?? CHANGE_LABEL_KEYS.modified),
    };
}

export type ScmChangeRowProps = Readonly<{
    theme: Theme;
    file: ScmFileStatus;
    /**
     * `inline` (default): `folder/name` on one line. `stacked`: the Git pane's name-first row
     * (session-tabs G1) — the file name over its folder, `+4 −2` at the end, and the trailing actions
     * (⋯) only on hover or keyboard focus on web, where they take the line counts' place.
     */
    layout?: 'inline' | 'stacked' | 'compact';
    /** Stacked: the other paths in the list, so a duplicate name gets its distinguishing folder. */
    siblingPaths?: readonly string[];
    /** Stacked: the folder line for a file at the repository root (the repository's name). */
    rootLabel?: string | null;
    onPress: () => void;
    onPressPinned?: () => void;
    onToggleSelection?: () => void;
    leadingElement?: React.ReactNode;
    trailingElement?: React.ReactNode;
    density?: 'comfortable' | 'compact';
    showDivider?: boolean;
    highlighted?: boolean;
    statsColumnWidth?: number;
    accessibilityQualification?: string;
    /**
     * The shared active-review-file scope (`activeReviewFile`): the row is highlighted while Review
     * is on its file. Row-local, so only the rows that change re-render as Review scrolls.
     */
    activeReviewFileKey?: string | null;
}>;

export const ScmChangeRow = React.memo((props: ScmChangeRowProps) => {
    const { theme, file, density = 'comfortable' } = props;
    const descriptor = describeChange(file, theme);
    const accessibilityLabel = [
        descriptor.label,
        t('files.changeRow.viewDiffA11y', { file: file.fullPath }),
        props.accessibilityQualification?.trim() || null,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('. ');
    const testIdSafePath = React.useMemo(() => toTestIdSafeValue(file.fullPath), [file.fullPath]);
    const isWeb = Platform.OS === 'web';

    const stacked = props.layout === 'stacked';
    // Compact: the name first and its folder after it, on one line (user ruling 2026-09-29).
    const compact = props.layout === 'compact';
    const isActiveReviewFile = useIsActiveReviewFile(props.activeReviewFileKey ?? null, file.fullPath);
    const highlighted = props.highlighted === true || isActiveReviewFile;
    const paddingVertical = stacked ? STACKED_ROW_PADDING_VERTICAL_PX : compact ? 0 : density === 'compact' ? 4 : 10;
    const minHeight = compact ? resolveCompactRowMinHeight() : undefined;
    const nameFirst = stacked || compact;
    // Web reveals the row's actions on hover or focus (touch has no hover, so they stay visible there).
    const [actionsRevealed, setActionsRevealed] = React.useState(false);
    const revealActions = React.useCallback(() => setActionsRevealed(true), []);
    const hideActions = React.useCallback(() => setActionsRevealed(false), []);
    const trailingShown = !(stacked || compact) || !isWeb || actionsRevealed;
    const statsShown = !(stacked || compact) || !props.trailingElement || !trailingShown;
    const statsColumnWidth = props.statsColumnWidth ?? resolveScmChangeStatsColumnWidth([file]);

    const containerStyle = React.useMemo(() => {
        // A stacked row under the pointer or keyboard focus takes the highlighted fill, so the ⋯ that
        // appears reads as belonging to it.
        const bg = highlighted || ((stacked || compact) && isWeb && actionsRevealed)
            ? (theme.colors.surface?.inset ?? theme.colors.surface?.base ?? theme.colors.text.secondary)
            : (theme.colors.surface?.base ?? theme.colors.text.secondary);
        return {
            paddingHorizontal: 12,
            paddingVertical,
            ...(minHeight !== undefined ? { minHeight } : null),
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: bg,
            borderBottomWidth: props.showDivider ? Platform.select({ ios: 0.33, default: 1 }) : 0,
            borderBottomColor: theme.colors.border?.default ?? theme.colors.text.secondary,
        } as const;
    }, [actionsRevealed, highlighted, isWeb, minHeight, paddingVertical, props.showDivider, stacked, theme.colors.border?.default, theme.colors.surface?.base, theme.colors.surface?.inset, theme.colors.text.secondary]);

    const onKeyDown = React.useCallback((event: any) => {
        if (!isWeb) return;
        const key = String(event?.key ?? '');
        if (key === 'Enter') {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (event?.shiftKey && props.onPressPinned) {
                props.onPressPinned();
            } else {
                props.onPress();
            }
            return;
        }
        if (key === ' ' || key === 'Spacebar') {
            if (!props.onToggleSelection) return;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            props.onToggleSelection();
        }
    }, [isWeb, props.onPress, props.onPressPinned, props.onToggleSelection]);

    const onClick = React.useCallback((event: any) => {
        if (!isWeb) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (event?.shiftKey && props.onPressPinned) {
            props.onPressPinned();
            return;
        }
        props.onPress();
    }, [isWeb, props.onPress, props.onPressPinned]);

    const rowContent = (
        <>
            <ScmChangeMark
                code={descriptor.code}
                color={descriptor.color}
                size={compact ? 'compact' : 'regular'}
                accessibilityLabel={descriptor.label}
            />

            {stacked || compact ? (
                <InlineRepoPathLabel
                    layout={compact ? 'nameFirst' : 'stacked'}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    fullPath={file.fullPath}
                    siblingPaths={props.siblingPaths}
                    rootLabel={props.rootLabel}
                    detail={file.status === 'renamed' && file.oldPath ? t('sessionGitPane.row.renamedFrom', { path: file.oldPath }) : null}
                    pathTextStyle={{
                        fontSize: 12,
                        color: theme.colors.text.secondary,
                        ...Typography.default(),
                    }}
                    nameTextStyle={{
                        fontSize: 13,
                        color: theme.colors.text.primary ?? theme.colors.text.secondary,
                        ...Typography.default('semiBold'),
                    }}
                />
            ) : (
                <InlineRepoPathLabel
                    fileName={file.fileName}
                    filePath={file.filePath}
                    fullPath={file.fullPath}
                    preferNameOverPath
                    alignForRootFiles={false}
                    pathTextStyle={{
                        flex: 0,
                        flexBasis: 'auto',
                        flexShrink: 1,
                        fontSize: 13,
                        color: theme.colors.text.secondary,
                        ...Typography.default(),
                    }}
                    nameTextStyle={{
                        fontSize: 13,
                        color: theme.colors.text.primary ?? theme.colors.text.secondary,
                        ...Typography.default('semiBold'),
                    }}
                />
            )}

            {statsShown ? (
            <View
                testID="scm-change-row-stats-column"
                style={{
                    width: nameFirst ? undefined : statsColumnWidth,
                    minWidth: nameFirst ? statsColumnWidth : undefined,
                    flexShrink: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: nameFirst ? 6 : 2,
                }}
            >
                {file.isComplete === false ? (
                    <Text accessibilityLabel={t('common.unavailable')} style={{ color: theme.colors.text.secondary }}>—</Text>
                ) : nameFirst ? (
                    <>
                        {file.linesAdded > 0 || file.linesRemoved <= 0 ? (
                            <Text style={{ fontSize: 12, fontVariant: ['tabular-nums'], color: theme.colors.state.success.foreground ?? theme.colors.text.secondary, ...Typography.default('semiBold') }}>
                                {`+${file.linesAdded}`}
                            </Text>
                        ) : null}
                        {file.linesRemoved > 0 ? (
                            <Text style={{ fontSize: 12, fontVariant: ['tabular-nums'], color: theme.colors.state.danger.foreground ?? theme.colors.text.secondary, ...Typography.default('semiBold') }}>
                                {`\u2212${file.linesRemoved}`}
                            </Text>
                        ) : null}
                    </>
                ) : (
                    <>
                        <Text style={{ fontSize: 11, fontVariant: ['tabular-nums'], color: theme.colors.state.success.foreground ?? theme.colors.text.secondary, ...Typography.default('semiBold') }}>
                            {`+${file.linesAdded}`}
                        </Text>
                        <Text style={{ fontSize: 11, fontVariant: ['tabular-nums'], color: theme.colors.text.secondary, ...Typography.default() }}>
                            {PATH_SEPARATOR}
                        </Text>
                        <Text style={{ fontSize: 11, fontVariant: ['tabular-nums'], color: theme.colors.state.danger.foreground ?? theme.colors.text.secondary, ...Typography.default('semiBold') }}>
                            {`-${file.linesRemoved}`}
                        </Text>
                    </>
                )}
            </View>
            ) : null}
        </>
    );

    const revealHandlers = (stacked || compact) && isWeb && props.trailingElement
        ? {
            onMouseEnter: revealActions,
            onMouseLeave: hideActions,
            onFocus: revealActions,
            onBlur: hideActions,
        }
        : null;

    return (
        <ViewWithClick
            testID={`scm-change-row-container:${testIdSafePath}`}
            style={containerStyle}
            {...(revealHandlers ?? {})}
        >
            {props.leadingElement ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {props.leadingElement}
                </View>
            ) : null}

            {isWeb ? (
                <ViewWithClick
                    testID={`scm-change-row-${testIdSafePath}`}
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    onClick={onClick as any}
                    onDoubleClick={
                        props.onPressPinned
                            ? (event: any) => {
                                event?.preventDefault?.();
                                event?.stopPropagation?.();
                                props.onPressPinned?.();
                            }
                            : undefined
                    }
                    tabIndex={0}
                    onKeyDown={onKeyDown as any}
                    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                    {rowContent}
                </ViewWithClick>
            ) : (
                <Pressable
                    testID={`scm-change-row-${testIdSafePath}`}
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    onPress={props.onPress}
                    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                    {rowContent}
                </Pressable>
            )}

            {props.trailingElement && trailingShown ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {props.trailingElement}
                </View>
            ) : null}
        </ViewWithClick>
    );
});
