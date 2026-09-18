import * as React from 'react';

import { createUiSurfaceMountIdentity } from './createUiSurfaceMountIdentity';

type RendererLifetime = Readonly<{
    isCurrent: () => boolean;
    onRetire: (listener: () => void) => Readonly<{ dispose: () => void }>;
}>;

/** Physical renderer lifetime only; admission and authority remain with the caller. */
export function useUiSurfaceRendererMount(input: Readonly<{
    lifetime: RendererLifetime;
    mountKey?: string;
    instanceId?: string | null;
    interactionEnabled: boolean;
    focusEligible: boolean;
}>) {
    const mount = React.useMemo(() => ({
        identity: input.instanceId === null ? null : createUiSurfaceMountIdentity(input.instanceId),
        controller: new AbortController(),
    }), [input.instanceId, input.lifetime, input.mountKey]);
    const eligibility = React.useRef(input);
    eligibility.current = input;
    const isCurrent = React.useCallback(() => (
        !mount.controller.signal.aborted && input.lifetime.isCurrent()
    ), [input.lifetime, mount]);
    const isFocusEligible = React.useCallback(() => (
        isCurrent() && eligibility.current.interactionEnabled && eligibility.current.focusEligible
    ), [isCurrent]);
    React.useLayoutEffect(() => {
        const retirement = input.lifetime.onRetire(() => mount.controller.abort());
        if (!input.lifetime.isCurrent()) mount.controller.abort();
        return () => {
            retirement.dispose();
            mount.controller.abort();
        };
    }, [input.lifetime, mount]);
    return { identity: mount.identity, signal: mount.controller.signal, isCurrent, isFocusEligible };
}
