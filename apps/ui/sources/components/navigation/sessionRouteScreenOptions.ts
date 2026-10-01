import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

/** The Session surfaces that draw their own header (the Session view and its cockpit surfaces). */
const SESSION_SURFACES_WITH_OWN_HEADER = new Set(['index', 'files', 'git', 'details', 'terminal']);

const SESSION_SURFACE_OPTIONS = {
    animation: 'none',
    headerShown: false,
} as const satisfies NativeStackNavigationOptions;

/**
 * Options for the root stack's `session/[id]` screen. Its `_layout` is a Slot, so the stack sees
 * one screen for every Session route and the nested route decides. Before the nested route has
 * resolved, the Slot's first child is the Session view itself (`index`).
 */
export function buildSessionRouteScreenOptions(input: Readonly<{
    childRouteName: string | undefined;
}>): NativeStackNavigationOptions {
    const child = input.childRouteName ?? 'index';
    return SESSION_SURFACES_WITH_OWN_HEADER.has(child) ? SESSION_SURFACE_OPTIONS : {};
}
