import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SessionSubagentQuickActions } from '@/components/sessions/agents/actions/SessionSubagentQuickActions';
import { SessionAgentActivitySummary } from '@/components/sessions/agents/presentation/SessionAgentActivitySummary';
import { resolveSessionAgentActivityPresentation } from '@/components/sessions/agents/presentation/sessionAgentActivityPresentation';
import type { SessionAgentActivityRow } from '@/components/sessions/agents/presentation/sessionAgentActivityRows';
import { Text } from '@/components/ui/text/Text';

import { SessionSubagentFactsRow } from './SessionSubagentFactsRow';

/**
 * One operational roster row: the shared activity summary plus the controls only this host has.
 *
 * The row used to resolve its own title, its own status colour from the RAW subagent status token,
 * and its own "waiting for approval" pill from a `hasPendingPermission` boolean threaded down from
 * the panel. All three are gone: identity and state come from
 * `resolveSessionAgentActivityPresentation` over the canonical merged entry, so this row, the
 * Details overview and a conversation's run reference cannot disagree.
 */

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        // 16 outer against 14 padding keeps the 8px state badge visually concentric inside it.
        borderRadius: 16,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 12,
    },
    rowMain: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    summary: {
        flex: 1,
        minWidth: 0,
    },
    activity: {
        color: theme.colors.text.primary,
        fontSize: 12,
    },
    footer: {
        gap: 8,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        gap: 8,
    },
    iconButton: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    },
}));

const ViewWithClick = View as unknown as React.ComponentType<
    React.ComponentPropsWithRef<typeof View> & { onClick?: any; onKeyDown?: any; tabIndex?: number }
>;

export const SessionSubagentRow = React.memo((props: Readonly<{
    sessionId: string;
    serverId?: string | null;
    row: SessionAgentActivityRow;
    activityPreview?: string | null;
    onOpenPreview: () => void;
    onOpenFull: (() => void) | null;
    onOpenAdvanced: (() => void) | null;
}>) => {
    const styles = stylesheet;
    const { entry, subagent } = props.row;
    const presentation = React.useMemo(
        () => resolveSessionAgentActivityPresentation({ entry, subagent }),
        [entry, subagent],
    );
    const openPreviewFromEvent = React.useCallback((event?: unknown) => {
        const maybeEvent = event as {
            stopPropagation?: () => void;
            nativeEvent?: { stopPropagation?: () => void };
            key?: string;
        } | undefined;
        try { maybeEvent?.stopPropagation?.(); } catch {}
        try { maybeEvent?.nativeEvent?.stopPropagation?.(); } catch {}
        props.onOpenPreview();
    }, [props]);

    const body = (
        <>
            <View testID={`session-subagent-main:${subagent.id}`} style={styles.rowMain}>
                <View style={styles.summary}>
                    <SessionAgentActivitySummary
                        testID={`session-subagent-summary:${subagent.id}`}
                        presentation={presentation}
                    />
                    {props.activityPreview ? (
                        <Text
                            testID={`session-subagent-activity:${subagent.id}`}
                            numberOfLines={2}
                            style={styles.activity}
                        >
                            {props.activityPreview}
                        </Text>
                    ) : null}
                </View>
                <SessionSubagentQuickActions
                    testID={`session-subagent-actions:${subagent.id}`}
                    sessionId={props.sessionId}
                    serverId={props.serverId}
                    subagent={subagent}
                    onOpenFull={
                        props.onOpenFull
                            ? () => {
                                props.onOpenFull?.();
                            }
                            : null
                    }
                    onSend={
                        subagent.capabilities.canSend
                            ? () => {
                                props.onOpenPreview();
                            }
                            : null
                    }
                    style={{ actions: styles.actions, iconButton: styles.iconButton }}
                />
            </View>
            <View testID={`session-subagent-footer:${subagent.id}`} style={styles.footer}>
                <SessionSubagentFactsRow subagent={subagent} onOpenAdvanced={props.onOpenAdvanced} />
            </View>
        </>
    );

    if (Platform.OS === 'web') {
        return (
            <ViewWithClick
                testID={`session-subagent-row:${subagent.id}`}
                accessibilityLabel={presentation.accessibilityLabel}
                onClick={openPreviewFromEvent}
                onKeyDown={(event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void; nativeEvent?: { stopPropagation?: () => void } }) => {
                    const key = String(event?.key ?? '');
                    if (key !== 'Enter' && key !== ' ') return;
                    event?.preventDefault?.();
                    openPreviewFromEvent(event);
                }}
                tabIndex={0}
                style={styles.row}
            >
                {body}
            </ViewWithClick>
        );
    }

    return (
        <Pressable
            testID={`session-subagent-row:${subagent.id}`}
            accessibilityRole="button"
            accessibilityLabel={presentation.accessibilityLabel}
            onPress={props.onOpenPreview}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.85 : 1 }]}
        >
            {body}
        </Pressable>
    );
});
