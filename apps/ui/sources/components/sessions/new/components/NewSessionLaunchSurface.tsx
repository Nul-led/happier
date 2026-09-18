import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { useReduceTransparency } from '@/hooks/ui/useReduceTransparency';
import {
    ModalPaneBoundaryView,
    useModalPaneBoundary,
} from '@/components/ui/panels/ModalPaneBoundary';
import type { FocusReturnTarget } from '@/keyboard/focusReturn';
import { t } from '@/text';

const OVERLAY_EDGE_PADDING = 16;
/** Keeps the launch card readable rather than stretching it across a desktop pane. */
const OVERLAY_MAX_CONTENT_WIDTH = 520;

/**
 * Keeps the canonical authoring tree mounted while one launch attempt owns the
 * screen. The overlay is presentation only; launch lifecycle remains with the
 * New Session model/controller.
 */
export function NewSessionLaunchSurface(props: Readonly<{
    children: React.ReactNode;
    overlay: React.ReactNode | null;
    onRequestClose: () => void;
    overlayPresentation?: 'card' | 'screen';
    focusReturnRef?: React.RefObject<FocusReturnTarget>;
    overlayAccessibilityLabel?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const insets = useChromeSafeAreaInsets();
    // Reduce Transparency means the retained composer must not show through the
    // frozen launch surface at all: the overlay becomes an opaque canonical
    // surface rather than a veil over live-looking controls that no longer work.
    const reduceTransparency = useReduceTransparency();
    const frozen = props.overlay !== null;
    const internalFocusReturnRef = React.useRef<FocusReturnTarget>(null);
    const focusReturnRef = props.focusReturnRef ?? internalFocusReturnRef;
    const boundary = useModalPaneBoundary({
        active: frozen,
        label: props.overlayAccessibilityLabel ?? t('newSession.temporaryComputer.title'),
        onRequestClose: props.onRequestClose,
        focusReturnRef,
        escapeEnabled: true,
        allowEditableEscape: true,
    });

    return (
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <ModalPaneBoundaryView
                ref={boundary.setUnderlayFocusRef}
                testID="new-session-launch-authoring"
                style={{ flex: 1, minWidth: 0, minHeight: 0 }}
                onFocus={(event) => {
                    if (!frozen) focusReturnRef.current = event.target as unknown as FocusReturnTarget;
                }}
                {...boundary.underlayProps}
            >
                {props.children}
            </ModalPaneBoundaryView>
            {frozen ? (
                <ModalPaneBoundaryView
                    ref={boundary.setOverlayFocusRef}
                    testID="new-session-launch-overlay"
                    {...boundary.overlayProps}
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        backgroundColor: props.overlayPresentation === 'screen' || reduceTransparency
                            ? theme.colors.surface.base
                            : theme.colors.surface.pressedOverlay,
                    }}
                >
                    {/*
                      * Bounded, not clipped. At 200% text — or on a short
                      * landscape phone — the card grows past the viewport, and a
                      * centered fixed box would push Cancel and the package
                      * export off screen with no way to reach them.
                      */}
                    {props.overlayPresentation === 'screen' ? (
                        <View
                            testID="new-session-full-screen-overlay"
                            style={{
                                flex: 1,
                                minHeight: 0,
                                paddingTop: insets.top,
                                paddingBottom: insets.bottom,
                                paddingLeft: insets.left,
                                paddingRight: insets.right,
                            }}
                        >
                            {props.overlay}
                        </View>
                    ) : <ScrollView
                        testID="new-session-launch-overlay-scroll"
                        style={{ flex: 1 }}
                        contentContainerStyle={{
                            flexGrow: 1,
                            justifyContent: 'center',
                            alignItems: 'center',
                            paddingTop: OVERLAY_EDGE_PADDING + insets.top,
                            paddingBottom: OVERLAY_EDGE_PADDING + insets.bottom,
                            paddingLeft: OVERLAY_EDGE_PADDING + insets.left,
                            paddingRight: OVERLAY_EDGE_PADDING + insets.right,
                        }}
                        keyboardShouldPersistTaps="handled"
                    >
                        <View style={{ width: '100%', maxWidth: OVERLAY_MAX_CONTENT_WIDTH }}>
                            {props.overlay}
                        </View>
                    </ScrollView>}
                </ModalPaneBoundaryView>
            ) : null}
        </View>
    );
}
