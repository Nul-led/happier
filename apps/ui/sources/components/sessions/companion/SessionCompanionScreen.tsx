import * as React from 'react';
import { I18nManager, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useMountedSessionBoardController } from '@/components/sessions/board/SessionBoardControllerProvider';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import type { SessionBoardPrimaryMountResolver } from '@/sync/domains/session/board';
import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';

import { SessionCompanionContent } from './SessionCompanionContent';
import {
    applySessionCompanionMutationWithNotice,
    buildSessionPresentationNoticeKeyPrefix,
} from './presentation/sessionCompanionPresentationAdapter';
import { buildSessionCompanionMenuActions } from './sessionCompanionMenu';
import { resolveSessionCompanionAddableItems } from './sessionCompanionContentModel';
import { useSessionCompanionController } from './state/useSessionCompanionController';
import type { SessionSummaryDestinationHandlers } from './summary/SessionSummaryCard';

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, minHeight: 0 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingStart: 16,
        paddingEnd: 6,
        paddingTop: 12,
    },
    heading: { ...Typography.eyebrow(), color: theme.colors.text.secondary, flex: 1, minWidth: 0 },
}));

/**
 * The host-owned full-height Companion destination in the mobile Cockpit.
 *
 * It renders the SAME Companion body the wide rail does — one content owner, one
 * widget host — inside the existing Cockpit chrome. It adds no navigator, no
 * sheet lifecycle and no mobile-only Companion implementation.
 */
type SessionCompanionScreenProps = Readonly<{
    sessionId: string;
    address: SessionAddress;
    onRevealBoardItem: (itemId: string) => void;
    onRequestClose: () => void;
    summaryDestinations?: SessionSummaryDestinationHandlers;
    resolvePrimaryHost: SessionBoardPrimaryMountResolver;
}>;

export const SessionCompanionScreen = React.memo(function SessionCompanionScreen(
    props: SessionCompanionScreenProps,
) {
    const styles = stylesheet;
    const mountedBoard = useMountedSessionBoardController(props.address);
    const session = useSessionViewShellSession(props.sessionId, props.address.serverId);
    const controller = useSessionCompanionController({
        sessionId: props.sessionId,
        serverId: props.address.serverId,
        // The full surface IS this screen; it never re-navigates to itself.
        openFullSurface: () => {},
    });
    const noticeKeyPrefix = React.useMemo(
        () => buildSessionPresentationNoticeKeyPrefix(props.address, props.sessionId),
        [props.address, props.sessionId],
    );
    const mutateCompanion = React.useCallback((input: Readonly<{
        kind: string;
        message: string;
        apply: Parameters<typeof applySessionCompanionMutationWithNotice>[0]['apply'];
    }>) => applySessionCompanionMutationWithNotice({
        companion: controller,
        publishNotice: publishPresentationNotice,
        noticeKeyPrefix,
        ...input,
    }), [controller, noticeKeyPrefix]);
    const addItem = React.useCallback((item: Parameters<typeof controller.addItem>[0]) => {
        mutateCompanion({
            kind: 'companion.item.add',
            message: t('sessionBoard.companion.notices.added'),
            apply: (companion) => companion.addItem(item),
        });
    }, [mutateCompanion]);

    const addableItems = React.useMemo(() => resolveSessionCompanionAddableItems({
        snapshot: mountedBoard?.binding.status === 'ready' ? mountedBoard.binding.snapshot : null,
        refs: controller.preference.items,
    }), [controller.preference.items, mountedBoard]);
    const manageBoardItemPlugin = React.useCallback((itemId: string) => {
        if (!mountedBoard?.controller.supports('item.managePlugin')) return;
        void mountedBoard.controller.run({ kind: 'item.managePlugin', itemId });
    }, [mountedBoard]);
    const removeBoardItem = React.useCallback((itemId: string) => {
        if (!mountedBoard?.controller.supports('item.remove')) return;
        void mountedBoard.controller.run({ kind: 'item.remove', itemId });
    }, [mountedBoard]);
    const canManageBoardItemPlugin = mountedBoard?.controller.supports('item.managePlugin') === true;
    const canRemoveBoardItem = mountedBoard?.controller.supports('item.remove') === true;
    const menuActions = React.useMemo(
        () => buildSessionCompanionMenuActions({
            preference: controller.preference,
            layoutDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
            addableItems,
            setEdge: (edge) => { mutateCompanion({
                kind: 'companion.edge.set',
                message: t('sessionBoard.companion.notices.moved'),
                apply: (companion) => companion.setEdge(edge),
            }); },
            setDensity: (density) => { mutateCompanion({
                kind: 'companion.density.set',
                message: density === 'compact'
                    ? t('sessionBoard.companion.actions.compact')
                    : t('sessionBoard.companion.actions.comfortable'),
                apply: (companion) => companion.setDensity(density),
            }); },
            // This surface is always full height, so collapse/expand would be
            // controls with no observable effect; they are absent, not disabled.
            setCollapsed: () => {},
            hide: () => {
                mutateCompanion({
                    kind: 'companion.hide',
                    message: t('sessionBoard.companion.notices.hidden'),
                    apply: (companion) => companion.hide(),
                });
                props.onRequestClose();
            },
            addItem,
        }).filter((action) => action.id !== 'collapse' && action.id !== 'expand'),
        [addItem, addableItems, controller.preference, mutateCompanion, props.onRequestClose],
    );

    if (!session) {
        return (
            <SurfaceStateCard
                testID="session-companion-screen-loading"
                kind="loading"
                title={t('sessionBoard.board.loading.title')}
                reason={t('sessionBoard.board.loading.reason')}
                accessibilitySemantics="status"
            />
        );
    }

    if (controller.availability !== 'ready') {
        return (
            <SurfaceStateCard
                testID="session-companion-screen-unavailable"
                kind="unavailable"
                title={t('sessionBoard.board.unavailable.title')}
                reason={t('sessionBoard.board.unavailable.reason')}
                diagnosticCode="session_companion_preference_realm_unavailable"
                accessibilitySemantics="status"
            />
        );
    }

    return (
        <View style={styles.root} testID="session-companion-screen">
            <View style={styles.header}>
                {/* The destination's own heading, reachable by heading navigation. */}
                <Text
                    numberOfLines={1}
                    style={styles.heading}
                    accessibilityRole="header"
                    testID="session-companion-screen-heading"
                >
                    {t('sessionBoard.companion.title')}
                </Text>
                <ItemRowActions
                    title={t('sessionBoard.companion.title')}
                    actions={menuActions}
                    compactThreshold={Number.POSITIVE_INFINITY}
                    overflowTriggerTestID="session-companion-screen-menu"
                    overflowTriggerAccessibilityLabel={t('sessionBoard.companion.actions.menuA11y')}
                    iconSize={18}
                    gap={6}
                />
            </View>
            <SessionCompanionContent
                session={session}
                serverId={props.address.serverId}
                controller={controller}
                boardBinding={mountedBoard?.binding ?? null}
                resolvePrimaryHost={props.resolvePrimaryHost}
                {...(mountedBoard?.pluginRuntime ? { pluginRuntime: mountedBoard.pluginRuntime } : {})}
                {...(mountedBoard
                    ? { resolveSourceAvailability: mountedBoard.controller.resolveSourceAvailability }
                    : {})}
                {...(mountedBoard?.callerHostedHtmlRuntime
                    ? { callerHostedHtmlRuntime: mountedBoard.callerHostedHtmlRuntime }
                    : {})}
                {...(props.summaryDestinations ? { summaryDestinations: props.summaryDestinations } : {})}
                onRevealBoardItem={props.onRevealBoardItem}
                {...(canManageBoardItemPlugin ? { onManageBoardItemPlugin: manageBoardItemPlugin } : {})}
                {...(canRemoveBoardItem ? { onRemoveBoardItem: removeBoardItem } : {})}
                presentation="full"
            />
        </View>
    );
});
