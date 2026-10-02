/**
 * The pixels of the phone's session switcher, as plain worklet-safe arithmetic so the gesture
 * worklets, the panel and a node test read one rule. The decisions are `sessionSwitcherGesture`'s.
 *
 * Transform and opacity only. No blur on the session: animating a blur across a live transcript is
 * a real GPU cost, so the session recedes (scale + rise) and a scrim laid out once at full size is
 * only faded over it.
 */

function unit(value: number): number {
    'worklet';
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** How far the session steps back while the switcher is open. */
const CONTENT_RECEDE_SCALE = 0.06;
const CONTENT_RECEDE_RISE_PX = 8;

export type SessionSwitcherContentMotion = Readonly<{ scale: number; translateY: number }>;

export function resolveSessionSwitcherContentMotion(open: number, reducedMotion: boolean): SessionSwitcherContentMotion {
    'worklet';
    // Reduced motion keeps the veil (the scrim) and drops the movement: the session dims, it does not travel.
    if (reducedMotion) return { scale: 1, translateY: 0 };
    const p = unit(open);
    if (p === 0) return { scale: 1, translateY: 0 };
    return { scale: 1 - CONTENT_RECEDE_SCALE * p, translateY: -CONTENT_RECEDE_RISE_PX * p };
}

/**
 * The panel as a ghost: it rises out of the bar the moment the bar moves up, firming with the
 * finger, and is solid by the lock. `ghost` is 0..1 toward the lock; `lift` is the bar's rise.
 */
export function resolveSessionSwitcherPanelMotion(params: Readonly<{
    ghost: number;
    lift: number;
    reducedMotion: boolean;
}>): Readonly<{ opacity: number; scale: number; translateY: number }> {
    'worklet';
    const g = unit(params.ghost);
    // Ease-out, so the first few points already say "something is coming".
    const eased = 1 - (1 - g) * (1 - g);
    const opacity = unit(eased * 2.6);
    if (params.reducedMotion) return { opacity, scale: 1, translateY: -params.lift };
    return { opacity, scale: 0.9 + 0.1 * eased, translateY: -params.lift };
}

/** One row of the ghost arriving: nearer rows firm up first. Rows are solid from the lock on. */
export function resolveSessionSwitcherRowReveal(ghost: number, rowIndex: number): number {
    'worklet';
    const eased = 1 - (1 - unit(ghost)) * (1 - unit(ghost));
    return unit(eased * 2.2 - rowIndex * 0.1);
}

/**
 * Keeps the selected row (and one beyond it) inside the panel's viewport. Offsets are measured
 * from the list's bottom edge, because the list grows upward from the bar.
 */
export function resolveSessionSwitcherRevealScroll(params: Readonly<{
    scroll: number;
    rowBottom: number;
    rowHeight: number;
    viewportHeight: number;
    contentHeight: number;
}>): number {
    'worklet';
    const maxScroll = params.contentHeight - params.viewportHeight > 0 ? params.contentHeight - params.viewportHeight : 0;
    let next = params.scroll;
    // Room for the next row above the selection, so further rows are always announced.
    const topLimit = params.viewportHeight - params.rowHeight;
    if (params.rowBottom + params.rowHeight - next > topLimit) next = params.rowBottom + params.rowHeight - topLimit;
    if (params.rowBottom - next < 0) next = params.rowBottom;
    if (next < 0) next = 0;
    return next > maxScroll ? maxScroll : next;
}
