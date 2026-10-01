import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useSessionSubagentActions } from '@/components/sessions/agents/actions/useSessionSubagentActions';
import { SessionAgentActivitySummary } from '@/components/sessions/agents/presentation/SessionAgentActivitySummary';
import { resolveSessionAgentActivityPresentation } from '@/components/sessions/agents/presentation/sessionAgentActivityPresentation';
import type { SessionAgentActivityRow } from '@/components/sessions/agents/presentation/sessionAgentActivityRows';
import { ContextMenu } from '@/components/ui/forms/dropdown/ContextMenu';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/**
 * One roster row (agents lab AG1): the Agent's mark, the title, one line that says where the work
 * stands, and — while it works — the latest activity in one muted line.
 *
 * Identity and state come from `resolveSessionAgentActivityPresentation` over the canonical merged
 * entry, so this row, the Details overview and a conversation's run reference cannot disagree. The
 * row carries no buttons: its operations are one gesture away (right-click / long-press), and the
 * row itself opens the work — or, for work waiting on a person, opens in place (the list decides).
 */

const stylesheet = StyleSheet.create((theme) => ({
    // A flat row on the pane's paper: no card around each unit of work.
    row: {
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 8,
        minHeight: 52,
    },
    activity: {
        ...Typography.default(),
        marginTop: 3,
        // Aligned under the title: past the 30px mark and its 10px gap.
        marginLeft: 40,
        color: theme.colors.text.tertiary,
        fontSize: 12,
        lineHeight: 16,
    },
}));

const ViewWithClick = View as unknown as React.ComponentType<
    React.ComponentPropsWithRef<typeof View> & {
        onClick?: (event: unknown) => void;
        onKeyDown?: (event: unknown) => void;
        onContextMenu?: (event: unknown) => void;
        tabIndex?: number;
        'aria-expanded'?: boolean;
    }
>;

type KeyboardLikeEvent = Readonly<{
    key?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    nativeEvent?: { stopPropagation?: () => void };
}>;

export const SessionSubagentRow = React.memo((props: Readonly<{
    sessionId: string;
    serverId?: string | null;
    row: SessionAgentActivityRow;
    activityPreview?: string | null;
    /** Where this work came from ("from Relay retry plan"), when the host resolved it. */
    originLabel?: string | null;
    /** The Session's own Agent, for the mark of work that does not name its own backend. */
    sessionAgentId?: string | null;
    /** What pressing the row does: open the work, or (needs-you rows) open it in place. */
    onPress: () => void;
    /** Set on a row that opens in place; announced as a disclosure. */
    expanded?: boolean;
    onOpenFull: (() => void) | null;
    onOpenAdvanced: (() => void) | null;
}>) => {
    const styles = stylesheet;
    const { entry, subagent } = props.row;
    const originLabel = props.originLabel ?? null;
    const sessionAgentId = props.sessionAgentId ?? null;
    const presentation = React.useMemo(
        () => resolveSessionAgentActivityPresentation({ entry, subagent, originLabel, sessionAgentId }),
        [entry, originLabel, sessionAgentId, subagent],
    );
    const actions = useSessionSubagentActions({
        sessionId: props.sessionId,
        serverId: props.serverId,
        subagent,
        onOpenFull: props.onOpenFull,
        onOpenAdvanced: props.onOpenAdvanced,
    });
    const anchorRef = React.useRef<View>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const hasActions = actions.items.length > 0;
    const openMenu = React.useCallback(() => {
        if (hasActions) setMenuOpen(true);
    }, [hasActions]);
    const { onPress } = props;

    const body = (
        <>
            <SessionAgentActivitySummary
                testID={`session-subagent-summary:${subagent.id}`}
                presentation={presentation}
                showTime
            />
            {presentation.phase === 'live' && props.activityPreview ? (
                <Text
                    testID={`session-subagent-activity:${subagent.id}`}
                    numberOfLines={1}
                    style={styles.activity}
                >
                    {props.activityPreview}
                </Text>
            ) : null}
        </>
    );
    // A sibling of the row, never its child: a portal still bubbles React events to its ancestors,
    // and a press on a menu item must not also open the row.
    const menu = hasActions ? (
        <ContextMenu
            testID={`session-subagent-actions:${subagent.id}`}
            anchorRef={anchorRef}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={actions.items}
            onSelect={(itemId) => {
                setMenuOpen(false);
                actions.select(itemId);
            }}
        />
    ) : null;

    if (Platform.OS === 'web') {
        return (<>
            <ViewWithClick
                ref={anchorRef}
                testID={`session-subagent-row:${subagent.id}`}
                accessibilityLabel={presentation.accessibilityLabel}
                aria-expanded={props.expanded}
                onClick={(event) => {
                    const maybe = event as KeyboardLikeEvent | undefined;
                    try { maybe?.stopPropagation?.(); } catch {}
                    onPress();
                }}
                onKeyDown={(event) => {
                    const maybe = event as KeyboardLikeEvent | undefined;
                    const key = String(maybe?.key ?? '');
                    if (key !== 'Enter' && key !== ' ') return;
                    maybe?.preventDefault?.();
                    onPress();
                }}
                onContextMenu={hasActions ? (event) => {
                    const maybe = event as KeyboardLikeEvent | undefined;
                    maybe?.preventDefault?.();
                    openMenu();
                } : undefined}
                tabIndex={0}
                style={styles.row}
            >
                {body}
            </ViewWithClick>
            {menu}
        </>);
    }

    return (<>
        <Pressable
            ref={anchorRef}
            testID={`session-subagent-row:${subagent.id}`}
            accessibilityRole="button"
            accessibilityLabel={presentation.accessibilityLabel}
            accessibilityState={props.expanded === undefined ? undefined : { expanded: props.expanded }}
            onPress={onPress}
            onLongPress={hasActions ? openMenu : undefined}
            style={({ pressed }) => [styles.row, { opacity: pressed ? motionTokens.press.opacitySubtle : 1 }]}
        >
            {body}
        </Pressable>
        {menu}
    </>);
});
