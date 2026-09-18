import * as React from 'react';
import * as safeAreaContext from 'react-native-safe-area-context';

/**
 * Safe-area insets for a surface that may mount outside a provider.
 *
 * `useSafeAreaInsets` throws when no provider is above it, which is the wrong
 * failure for an app-global overlay: the notch is a geometry fact, and a floating
 * control that cannot read it should sit at the window edge rather than crash the
 * tree. This reads the same canonical context and falls back to zero, so there is
 * one owner for "the insets, if anyone has measured them".
 */

export type OptionalSafeAreaInsets = Readonly<{
    top: number;
    right: number;
    bottom: number;
    left: number;
}>;

export const ZERO_SAFE_AREA_INSETS: OptionalSafeAreaInsets = Object.freeze({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
});

const SafeAreaInsetsContext = (
    safeAreaContext as unknown as {
        SafeAreaInsetsContext?: React.Context<OptionalSafeAreaInsets | null>;
    }
).SafeAreaInsetsContext ?? React.createContext<OptionalSafeAreaInsets | null>(ZERO_SAFE_AREA_INSETS);

export function useOptionalSafeAreaInsets(): OptionalSafeAreaInsets {
    return React.useContext(SafeAreaInsetsContext) ?? ZERO_SAFE_AREA_INSETS;
}
