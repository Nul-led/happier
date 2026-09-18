import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { useNativeBackLayerBackHandler } from '@/components/ui/overlays/NativeBackLayerBoundary';
import { Popover } from '@/components/ui/popover';
import { SelectionListBackChip } from '@/components/ui/selectionList/SelectionListBackChip';
import { restoreFocusToBestTarget } from '@/keyboard/focusReturn';
import { serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';
import { useIsTablet } from '@/utils/platform/responsive';

import { SessionResponsibilityPicker } from './SessionResponsibilityPicker';
import type { SessionResponsibilityController } from './useSessionResponsibilityController';

const styles = StyleSheet.create({
    step: { flex: 1, minHeight: 0, minWidth: 0 },
    stepHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
});

type OpenedPicker = Readonly<{
    /** The exact `{serverId, accountId, sessionId}` this picker was opened for. */
    targetKey: string;
    /** Which responsive host is currently presenting it. */
    anchored: boolean;
}>;

export type SessionResponsibilityPickerHost = Readonly<{
    anchorRef: React.RefObject<View | null>;
    /** The Responsibility row itself, so both hosts can return focus to it. */
    triggerRef: React.RefObject<React.ComponentRef<typeof Pressable> | null>;
    openPicker: () => void;
    closePicker: () => void;
    /** The wide anchored overlay, rendered inline beside the invoking row. */
    picker: React.ReactElement | null;
    /**
     * The compact pushed selection step. The Collaboration surface renders it in
     * place of its retained body, so this is a real surface transition rather
     * than an overlay above the surface it came from.
     */
    compactStep: React.ReactElement | null;
    /** Whether the compact step currently owns the Collaboration surface. */
    compactStepOpen: boolean;
}>;

/**
 * The one responsive host for the Responsibility selection step.
 *
 * Wide desktop/web anchors the existing `SelectionList` step to the invoking
 * row. Compact/mobile pushes the existing `SelectionListScreen` step over the
 * Collaboration surface: the surface deactivates its retained body and renders
 * `compactStep` instead, so the user moves to a step and comes back rather than
 * reading the list through a floating card. Both hosts receive the same mounted
 * controller, so there is no second candidate/mutation owner and no
 * host-specific selection behavior.
 *
 * The compact step is deliberately not a global modal and not a route. A modal
 * card is not the pushed workflow the surface owes a phone, and a route would
 * mount a second `useSessionResponsibilityController` for the same Session. It
 * is also not an overlay: the Collaboration body stays mounted but inert, so
 * scroll position, draft state and focus survive the round trip.
 *
 * The open picker is bound to the address it was opened for: a target change
 * dismisses it, unmount dismisses it, and the mounted controller refuses any
 * mutation once its own exact target is no longer live. Capability loss
 * deliberately does not dismiss — the picker becomes read-only and states
 * "Access changed" through the shared controller.
 */
export function useSessionResponsibilityPickerHost(params: Readonly<{
    sessionId: string;
    scope: ServerAccountScope;
    actingAccountId: string | null;
    controller: SessionResponsibilityController;
    editable: boolean;
    /** Whether the Responsibility row itself is still rendered for this target. */
    available: boolean;
}>): SessionResponsibilityPickerHost {
    const anchorRef = React.useRef<View | null>(null);
    const triggerRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
    const anchored = useIsTablet();
    const targetKey = `${serverAccountScopeKeySuffix(params.scope)}:${params.sessionId}`;
    const [opened, setOpened] = React.useState<OpenedPicker | null>(null);
    // Read at open time so the host never captures a superseded target.
    const latest = React.useRef(params);
    latest.current = params;

    const openedRef = React.useRef<OpenedPicker | null>(opened);
    openedRef.current = opened;
    // The anchored host returns focus through the popover's own
    // `focusReturnRef`. The compact step has no overlay host above it, so it owns
    // the return to the row the user activated — but only after the surface has
    // re-activated its body. Focusing during the closing event would target a row
    // that is still inside the hidden panel, which silently does nothing.
    const focusReturnPending = React.useRef(false);

    const dismissPicker = React.useCallback(() => {
        focusReturnPending.current = false;
        setOpened(null);
    }, []);

    const closePicker = React.useCallback(() => {
        focusReturnPending.current = openedRef.current !== null && !openedRef.current.anchored;
        setOpened(null);
    }, []);

    const openPicker = React.useCallback(() => {
        const current = latest.current;
        if (!current.editable) return;
        setOpened({
            targetKey: `${serverAccountScopeKeySuffix(current.scope)}:${current.sessionId}`,
            anchored,
        });
    }, [anchored]);

    // A picker opened for another exact Session/Home — or presented by the other
    // responsive host — can no longer mutate anything, so it is dismissed rather
    // than left over the new target.
    React.useEffect(() => {
        if (opened === null) return;
        if (params.available && opened.targetKey === targetKey && opened.anchored === anchored) return;
        // An involuntary dismissal is not a user close: the row it came from is
        // retired or belongs to another target, so nothing claims focus here.
        dismissPicker();
    }, [anchored, dismissPicker, opened, params.available, targetKey]);

    const compactStepOpen = opened !== null && !opened.anchored && opened.targetKey === targetKey;

    React.useEffect(() => {
        if (compactStepOpen || !focusReturnPending.current) return;
        focusReturnPending.current = false;
        restoreFocusToBestTarget(triggerRef);
    }, [compactStepOpen]);

    // Hardware/gesture Back pops this step back to Collaboration instead of
    // leaving the Session, through the existing embedded back-layer owner.
    useNativeBackLayerBackHandler(compactStepOpen, React.useCallback(() => {
        closePicker();
        return true;
    }, [closePicker]));

    const picker = opened !== null && opened.anchored && opened.targetKey === targetKey ? (
        <Popover
            open
            anchorRef={anchorRef}
            placement="bottom"
            maxWidthCap={520}
            maxHeightCap={560}
            autoFocusOnOpen
            focusReturnRef={triggerRef}
            onRequestClose={closePicker}
            portal={{ web: true, native: true, matchAnchorWidth: false }}
        >
            {({ maxHeight }) => (
                <FloatingOverlay maxHeight={maxHeight} scrollEnabled={false} surfaceChrome="theme">
                    <View
                        testID="session-responsibility-picker-anchored"
                        accessibilityLabel={t('session.responsibilityPickerTitle')}
                        style={{ maxHeight, minHeight: 0 }}
                    >
                        <SessionResponsibilityPicker
                            sessionId={params.sessionId}
                            scope={params.scope}
                            actingAccountId={params.actingAccountId}
                            controller={params.controller}
                            presentation="anchored"
                            onResolved={closePicker}
                            onClose={closePicker}
                        />
                    </View>
                </FloatingOverlay>
            )}
        </Popover>
    ) : null;

    const compactStep = compactStepOpen ? (
        <View
            testID="session-responsibility-step"
            accessibilityLabel={t('session.responsibilityPickerTitle')}
            style={styles.step}
        >
            <View style={styles.stepHeader}>
                <SelectionListBackChip
                    testID="session-responsibility-step-back"
                    label={t('session.collaboration.title')}
                    onPress={closePicker}
                />
            </View>
            <SessionResponsibilityPicker
                sessionId={params.sessionId}
                scope={params.scope}
                actingAccountId={params.actingAccountId}
                controller={params.controller}
                presentation="screen"
                onResolved={closePicker}
                onClose={closePicker}
            />
        </View>
    ) : null;

    return { anchorRef, triggerRef, openPicker, closePicker, picker, compactStep, compactStepOpen };
}
