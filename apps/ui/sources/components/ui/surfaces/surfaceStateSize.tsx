import type { HappierStateSize } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';

/**
 * The size step of the state composition, set once by the container that hosts a surface (the right
 * sidebar pane, the details drawer, a phone pane) so every `SurfaceStateCard` inside it takes the
 * container's measure and type without each surface hand-sizing its states. An explicit `size` on a
 * card still wins; outside any provider the card keeps its unsized centred column.
 */
const SurfaceStateSizeContext = React.createContext<HappierStateSize | undefined>(undefined);

export function SurfaceStateSizeProvider(props: Readonly<{ size: HappierStateSize; children: React.ReactNode }>) {
    return (
        <SurfaceStateSizeContext.Provider value={props.size}>
            {props.children}
        </SurfaceStateSizeContext.Provider>
    );
}

export function useSurfaceStateSize(): HappierStateSize | undefined {
    return React.useContext(SurfaceStateSizeContext);
}
