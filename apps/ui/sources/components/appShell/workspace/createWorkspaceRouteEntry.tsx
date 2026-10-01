import * as React from 'react';
import { useOptionalWorkspaceNavigation } from './WorkspaceNavigationContext';

/** The Expo screen is only the URL sink when the desktop workspace hosts its body. */
export function WorkspaceRouteEntry(props: Readonly<{ Body: React.ComponentType }>) {
    const workspace = useOptionalWorkspaceNavigation();
    return workspace?.active === true ? null : <props.Body />;
}
