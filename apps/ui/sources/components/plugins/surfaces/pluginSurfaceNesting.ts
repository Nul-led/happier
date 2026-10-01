import * as React from 'react';

/**
 * The one stop for plugin surfaces nested inside an embedded Session presentation (plan 05 `SC-R6`).
 *
 * A plugin's `SessionChat` renders Happier's Session view, which itself hosts plugin surfaces
 * (composer regions, session widgets, launch cards). Beneath this boundary the physical mount
 * owner (`PluginSurfaceHost`) mounts nothing, so a Session shown inside a plugin can never mount a
 * plugin surface — including the one that is showing it. There is no depth counter or per-family
 * list: the boundary is the whole rule.
 */
const PluginSurfaceNestingBoundaryContext = React.createContext(false);

export function PluginSurfaceNestingBoundary(props: Readonly<{ children?: React.ReactNode }>) {
    return React.createElement(PluginSurfaceNestingBoundaryContext.Provider, { value: true }, props.children);
}

export function useIsBeneathPluginSurfaceNestingBoundary(): boolean {
    return React.useContext(PluginSurfaceNestingBoundaryContext);
}
