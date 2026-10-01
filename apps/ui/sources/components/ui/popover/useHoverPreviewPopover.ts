import * as React from 'react';

import { motionTokens } from '@/components/ui/motion';

/** How long the pointer may be between a trigger and its preview before the preview closes. */
const HOVER_CLOSE_GRACE_MS = motionTokens.durationMs.fast;
/**
 * After a preview closes because the pointer left, a trigger entered this soon reopens it at once: the
 * pointer already showed its intent, and the preview may still be leaving (its exit turns around).
 */
const HOVER_REOPEN_WINDOW_MS = motionTokens.overlay.popover.hoverOpenDelayMs;

/** `preview`: opened by the pointer resting on the trigger, without focus. `open`: opened on purpose, focus moves in. */
export type HoverPreviewMode = 'closed' | 'preview' | 'open';

type HoverPreviewState<T> = Readonly<{ mode: HoverPreviewMode; target: T | null }>;

export type HoverPreviewHandlers = Readonly<{ onPointerEnter: () => void; onPointerLeave: () => void }>;

/**
 * The open state of a surface that previews on hover. Resting the pointer on a trigger opens a
 * `preview` of that trigger's target after the popover rest delay; leaving the trigger closes a
 * preview after a short grace, which the pointer entering the preview cancels. While one target is
 * previewed, resting on another trigger switches to it at once, and a trigger entered just after a
 * preview closed reopens it at once. `open()` opens it on purpose (a press
 * or a key), which leaving never closes; Escape and outside presses close it (`close`).
 *
 * One trigger (a popover button): spread `hoverProps` on the trigger and the popover's content.
 * Several (the rail's destinations over one column): `triggerHoverProps(target)` on each trigger and
 * `panelHoverProps` on the shared preview.
 */
export function useHoverPreviewPopover<T = true>(params: Readonly<{ enabled: boolean }>) {
    const [state, setState] = React.useState<HoverPreviewState<T>>({ mode: 'closed', target: null });
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearTimer = React.useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);
    // Set while a preview has just closed on the pointer leaving (`HOVER_REOPEN_WINDOW_MS`).
    const reopenTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const endReopenWindow = React.useCallback(() => {
        if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
        reopenTimerRef.current = null;
    }, []);
    React.useEffect(() => () => {
        clearTimer();
        endReopenWindow();
    }, [clearTimer, endReopenWindow]);

    const close = React.useCallback(() => {
        clearTimer();
        endReopenWindow();
        setState({ mode: 'closed', target: null });
    }, [clearTimer, endReopenWindow]);
    const open = React.useCallback((target: T = true as T) => {
        clearTimer();
        endReopenWindow();
        setState({ mode: 'open', target });
    }, [clearTimer, endReopenWindow]);
    const toggle = React.useCallback((target: T = true as T) => {
        clearTimer();
        endReopenWindow();
        // A press on a previewing popover keeps it open and hands it to the press (focus moves in).
        setState((current) => (current.mode === 'open' ? { mode: 'closed', target: null } : { mode: 'open', target }));
    }, [clearTimer, endReopenWindow]);

    const enterTrigger = React.useCallback((target: T) => {
        clearTimer();
        if (state.mode === 'closed' && reopenTimerRef.current) {
            endReopenWindow();
            setState({ mode: 'preview', target });
            return;
        }
        if (state.mode === 'closed') {
            timerRef.current = setTimeout(
                () => setState((current) => (current.mode === 'closed' ? { mode: 'preview', target } : current)),
                motionTokens.overlay.popover.hoverOpenDelayMs,
            );
            return;
        }
        // Already showing: another trigger takes it over at once.
        if (!Object.is(state.target, target)) setState({ mode: 'preview', target });
    }, [clearTimer, endReopenWindow, state.mode, state.target]);
    const enterPanel = React.useCallback(() => clearTimer(), [clearTimer]);
    const leave = React.useCallback(() => {
        clearTimer();
        if (state.mode === 'closed') return;
        const closesPreview = state.mode === 'preview';
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setState((current) => (current.mode === 'preview' ? { mode: 'closed', target: null } : current));
            if (!closesPreview) return;
            endReopenWindow();
            reopenTimerRef.current = setTimeout(() => { reopenTimerRef.current = null; }, HOVER_REOPEN_WINDOW_MS);
        }, HOVER_CLOSE_GRACE_MS);
    }, [clearTimer, endReopenWindow, state.mode]);

    const enabled = params.enabled;
    React.useEffect(() => {
        if (!enabled) close();
    }, [close, enabled]);
    const triggerHoverProps = React.useCallback(
        (target: T): HoverPreviewHandlers | null => (enabled ? { onPointerEnter: () => enterTrigger(target), onPointerLeave: leave } : null),
        [enabled, enterTrigger, leave],
    );
    const panelHoverProps = React.useMemo<HoverPreviewHandlers | null>(
        () => (enabled ? { onPointerEnter: enterPanel, onPointerLeave: leave } : null),
        [enabled, enterPanel, leave],
    );
    const hoverProps = React.useMemo(() => triggerHoverProps(true as T), [triggerHoverProps]);
    return { mode: state.mode, target: state.target, open, close, toggle, hoverProps, triggerHoverProps, panelHoverProps };
}
