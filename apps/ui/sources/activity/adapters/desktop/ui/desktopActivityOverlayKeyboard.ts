/**
 * Key semantics shared by the desktop Activity island's keyboard ingress points.
 *
 * The expanded shell reads bubbled `keydown`, while `react-native-web`'s `TextInput` stops key
 * propagation (`exports/TextInput` `handleKeyDown`). Text-input owners therefore classify and
 * forward a safe dismiss explicitly; the route remains the only place that performs collapse and
 * focus restoration.
 */
export type DesktopActivityOverlayKeyEvent = Readonly<{
    key?: string | null;
    nativeEvent?: Readonly<{ key?: string | null }> | null;
}>;

export function readDesktopActivityOverlayEventKey(
    event: DesktopActivityOverlayKeyEvent | null | undefined,
): string | null {
    return event?.key ?? event?.nativeEvent?.key ?? null;
}

/** `Esc` is the legacy spelling still emitted by some embedded web hosts. */
export function isDesktopActivityOverlayDismissKey(key: string | null): boolean {
    return key === 'Escape' || key === 'Esc';
}

/** The keys `react-native-web`'s press responder turns into a `Pressable` press. */
export function isDesktopActivityOverlayActivationKey(key: string | null): boolean {
    return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
