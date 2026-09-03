/**
 * How much room the seated Search plane may take, and how much of it the results region gets.
 *
 * Kept out of the component because it is the one part of the native host that a renderer test can
 * falsify: the plane itself is laid out by `KeyboardAwareScreen` and the software keyboard, neither
 * of which a host renderer reproduces.
 */

/** Breathing room between the status bar / safe-area edge and the top of the results region. */
export const UNIVERSAL_SEARCH_PLANE_TOP_GAP_PX = 12;

export function resolveUniversalSearchPlaneMaxHeight(params: Readonly<{
    windowHeight: number;
    safeAreaTop: number;
    /**
     * Bottom safe area, always reserved.
     *
     * With the keyboard down the plane pads itself by this inset to clear the home indicator. With
     * the keyboard up the keyboard-aware frame reserves the WHOLE keyboard frame, while
     * `useKeyboardHeight` reports the settled height with that same inset already deducted on iOS —
     * so the inset is reserved in both states and is never subtracted twice. On Android the
     * keyboard covers the navigation bar and the reported height already spans it, which makes this
     * a few pixels conservative there: a slightly shorter results region, never one that overruns
     * the frame and pushes rows under the status bar.
     */
    safeAreaBottom: number;
    /** Settled software-keyboard height; 0 when the keyboard is down. */
    keyboardHeight: number;
    /** Space reserved above the plane for the floating close/dismiss capsules. */
    capsuleRowHeight: number;
}>): number {
    const available = params.windowHeight
        - Math.max(0, params.safeAreaTop)
        - Math.max(0, params.safeAreaBottom)
        - Math.max(0, params.keyboardHeight)
        - Math.max(0, params.capsuleRowHeight)
        - UNIVERSAL_SEARCH_PLANE_TOP_GAP_PX;

    if (!Number.isFinite(available)) return 0;
    // The keyboard-aware frame is the hard boundary. On a short rotated window
    // it is better for the result body to collapse temporarily than for the
    // input or rows to be laid out under system chrome or outside the screen.
    return Math.max(0, Math.round(available));
}
