/**
 * The interaction state `react-native-web` hands to a `Pressable` style callback. `hovered` and
 * `focused` are web-only, so they stay optional for native renders.
 */
export type DesktopActivityOverlayPressableInteractionState = Readonly<{
    pressed: boolean;
    hovered?: boolean;
    focused?: boolean;
}>;
