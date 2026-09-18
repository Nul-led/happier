import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { TabBadge } from '@/components/ui/navigation/tabBadge/TabBadge';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { t } from '@/text';
import type { ActionOperationProjection } from '@/sync/domains/actionOperations/actionOperationSelectors';
import { actionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';
import { actionOperationAddress } from '@/sync/domains/actionOperations/qualifiedActionOperation';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import {
    useActionOperationsHaveAttention,
    useAllActionOperations,
} from '@/sync/domains/actionOperations/useActionOperations';

import { ActionOperationLedgerView } from './ActionOperationLedger';
import { openActionOperation } from './actionOperationPresentationRuntime';
import { requestAcceptedActionOperationStop } from './requestActionOperationStop';

export type ActionOperationActivityButtonViewProps = Readonly<{
    operations: readonly ActionOperationProjection[];
    hasAttention: boolean;
    preferredSessionAddress?: SessionAddress | null;
    onOpenOperation: (operation: ActionOperationProjection) => void;
    onCancelOperation?: (operation: ActionOperationProjection) => Promise<void> | void;
    onDismissOperation?: (operation: ActionOperationProjection) => void;
    onMarkVisibleTerminalSeen: () => void;
    onClearRecent?: () => void;
    tintColor?: string;
    buttonSize?: number;
    iconSize?: number;
    testID?: string;
}>;

export const ActionOperationActivityButtonView = React.memo(function ActionOperationActivityButtonView(
    props: ActionOperationActivityButtonViewProps,
) {
    const { theme } = useUnistyles();
    const anchorRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);
    const [webAnchorRect, setWebAnchorRect] = React.useState<Readonly<{
        left: number;
        top: number;
        width: number;
        height: number;
    }> | null>(null);
    const visible = props.hasAttention || open;
    const activeCount = props.operations.reduce(
        (count, operation) => count + (
            (operation.snapshot.state === 'accepted' || operation.snapshot.state === 'running')
            && operation.observation === 'available'
                ? 1
                : 0
        ),
        0,
    );

    React.useEffect(() => {
        if (open) props.onMarkVisibleTerminalSeen();
    }, [open, props.onMarkVisibleTerminalSeen, props.operations]);

    const handleOpenOperation = React.useCallback((operation: ActionOperationProjection) => {
        setOpen(false);
        props.onOpenOperation(operation);
    }, [props.onOpenOperation]);
    const handleClearRecent = React.useCallback(() => {
        props.onClearRecent?.();
        setOpen(false);
    }, [props.onClearRecent]);

    if (!visible) return null;

    const tintColor = props.tintColor ?? theme.colors.chrome.header.foreground;
    return (
        <View ref={anchorRef} collapsable={false} style={styles.anchor}>
            <Pressable
                testID={props.testID ?? 'action-operation-activity-button'}
                accessibilityRole="button"
                accessibilityLabel={t('inbox.updates')}
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                onPress={(event) => {
                    if (!open && Platform.OS === 'web') {
                        const target = event?.currentTarget as unknown as {
                            getBoundingClientRect?: () => Readonly<{
                                left: number;
                                top: number;
                                width: number;
                                height: number;
                            }>;
                        };
                        const rect = target?.getBoundingClientRect?.();
                        if (rect) {
                            setWebAnchorRect({
                                left: rect.left,
                                top: rect.top,
                                width: rect.width,
                                height: rect.height,
                            });
                        }
                    }
                    setOpen((current) => !current);
                }}
                style={({ pressed }) => [
                    styles.button,
                    props.buttonSize != null ? {
                        width: props.buttonSize,
                        height: props.buttonSize,
                        borderRadius: props.buttonSize / 2,
                    } : null,
                    pressed ? styles.buttonPressed : null,
                ]}
            >
                <View style={styles.glyph}>
                    <Icon name="pulse" size={props.iconSize ?? ICON_SIZE.md} color={tintColor} />
                    {activeCount > 0 ? (
                        <TabBadge testID="action-operation-activity-count" variant="count" value={activeCount} tone="neutral" />
                    ) : (
                        <TabBadge testID="action-operation-activity-attention-dot" variant="dot" />
                    )}
                </View>
            </Pressable>
            {open ? (
                <Popover
                    open={true}
                    anchorRef={anchorRef}
                    anchor={webAnchorRect ? {
                        kind: 'rect',
                        rect: webAnchorRect,
                        coordinateSpace: 'window',
                    } : undefined}
                    boundaryRef={null}
                    placement="bottom"
                    edgePadding={{ horizontal: 12, vertical: 12 }}
                    portal={{ web: { target: 'body' }, native: true, matchAnchorWidth: false, anchorAlign: 'end' }}
                    maxWidthCap={420}
                    maxHeightCap={560}
                    onRequestClose={() => setOpen(false)}
                >
                    {({ maxHeight, maxWidth }) => (
                        <FloatingOverlay
                            maxHeight={Math.min(maxHeight, 560)}
                            edgeFades={{ top: true, bottom: true, size: 18 }}
                            edgeIndicators={true}
                            surfaceChrome="theme"
                            containerStyle={{ width: Math.min(maxWidth, 400) }}
                        >
                            <ActionOperationLedgerView
                                operations={props.operations}
                                preferredSessionAddress={props.preferredSessionAddress}
                                onOpenOperation={handleOpenOperation}
                                onCancelOperation={props.onCancelOperation}
                                onDismissOperation={props.onDismissOperation}
                                onClearRecent={props.onClearRecent ? handleClearRecent : undefined}
                            />
                            <View style={styles.popoverBottomInset} />
                        </FloatingOverlay>
                    )}
                </Popover>
            ) : null}
        </View>
    );
});

export const ActionOperationActivityButton = React.memo(function ActionOperationActivityButton(props: Readonly<{
    preferredSessionAddress?: SessionAddress | null;
    tintColor?: string;
    buttonSize?: number;
    iconSize?: number;
    testID?: string;
}>) {
    const operations = useAllActionOperations();
    const hasAttention = useActionOperationsHaveAttention();
    const markVisibleTerminalSeen = React.useCallback(() => {
        actionOperationStore.markAllTerminalSeen();
    }, []);
    const stopOperation = React.useCallback(async (operation: ActionOperationProjection) => {
        await requestAcceptedActionOperationStop(operation);
    }, []);
    return (
        <ActionOperationActivityButtonView
            operations={operations}
            hasAttention={hasAttention}
            preferredSessionAddress={props.preferredSessionAddress}
            tintColor={props.tintColor}
            buttonSize={props.buttonSize}
            iconSize={props.iconSize}
            testID={props.testID}
            onOpenOperation={openActionOperation}
            onCancelOperation={stopOperation}
            onDismissOperation={(operation) => actionOperationStore.dismissUnavailable(
                actionOperationAddress(operation.serverId, operation.snapshot.operationId),
            )}
            onMarkVisibleTerminalSeen={markVisibleTerminalSeen}
            onClearRecent={actionOperationStore.dismissRecentSucceeded}
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    anchor: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    button: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
    },
    buttonPressed: {
        opacity: 0.68,
        transform: [{ scale: 0.96 }],
    },
    glyph: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    popoverBottomInset: {
        height: 14,
    },
}));
