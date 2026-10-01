import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { ScmFileStatus } from '@/scm/scmStatusFiles';
import { t } from '@/text';
import { ScmChangeRow } from '@/components/workspaces/scm/changes/ScmChangeRow';
import { useChangedFileRowLayout } from '@/components/workspaces/scm/changes/useChangedFileRowLayout';


/**
 * Review's file list, first (details lab 2, R1): every changed file on one row — its status, where
 * it lives, its comments, how much changed and whether it goes in the next commit. A row jumps to
 * that file in the stream below. Drawn only when the change set is small enough to stream; a large
 * one keeps the one-file-at-a-time list, so this never lays out thousands of rows.
 */
export const ChangedFilesReviewIndex = React.memo(function ChangedFilesReviewIndex(props: Readonly<{
    files: readonly ScmFileStatus[];
    activePath: string | null;
    commentCountByPath: ReadonlyMap<string, number>;
    onFocusPath: (path: string) => void;
    /** The shared active-review-file scope, so the row Review is on stays highlighted. */
    activeReviewFileKey?: string | null;
    /** The commit checkbox for a file (the Review owner's commit selection control). */
    renderCommitToggle?: ((file: ScmFileStatus) => React.ReactNode) | null;
    onLayout?: (event: LayoutChangeEvent) => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const rowLayout = useChangedFileRowLayout();
    const siblingPaths = React.useMemo(() => props.files.map((file) => file.fullPath), [props.files]);
    return (
        <View testID="scm-review-index" style={styles.index} onLayout={props.onLayout}>
            <View style={styles.caption}>
                <Text style={styles.captionTitle}>{t('detailsSurface.review.changedFiles')}</Text>
                <Text style={styles.captionCount}>{String(props.files.length)}</Text>
                <View style={styles.grow} />
                {props.renderCommitToggle ? <Text style={styles.captionCount}>{t('detailsSurface.review.commitColumn')}</Text> : null}
            </View>
            {props.files.map((file) => {
                const comments = props.commentCountByPath.get(file.fullPath) ?? 0;
                return (
                    <ScmChangeRow
                        key={file.fullPath}
                        theme={theme}
                        file={file}
                        layout={rowLayout}
                        siblingPaths={siblingPaths}
                        highlighted={props.activePath === file.fullPath}
                        activeReviewFileKey={props.activeReviewFileKey ?? null}
                        onPress={() => props.onFocusPath(file.fullPath)}
                        leadingElement={props.renderCommitToggle ? props.renderCommitToggle(file) : null}
                        trailingElement={comments > 0 ? (
                            <View style={styles.comments} accessibilityLabel={t('detailsSurface.review.comments', { count: comments })}>
                                <Icon name="chat-circle" size={12} color={theme.colors.state.active.foreground} />
                                <Text style={[styles.count, { color: theme.colors.state.active.foreground }]}>{String(comments)}</Text>
                            </View>
                        ) : null}
                    />
                );
            })}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    index: {
        paddingTop: 6,
        paddingBottom: 10,
        paddingHorizontal: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.subtle,
    },
    caption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 6,
        paddingBottom: 4,
        paddingLeft: 12,
        paddingRight: 8,
    },
    captionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.text.secondary,
    },
    captionCount: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text.tertiary,
    },
    grow: {
        flex: 1,
    },
    comments: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    count: {
        ...Typography.default(),
        fontSize: 11.5,
        fontVariant: ['tabular-nums'],
    },
}));
