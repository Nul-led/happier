import * as React from 'react';
import { useCompactAppDestinations } from '../destinations/compactAppDestinationCatalog';
import { WorkspaceProvider } from './WorkspaceProvider';
import { useWorkspaceShellEnabled } from './useWorkspaceShellEnabled';

/** Above the palette and rail so every workspace launcher reaches the same owner. */
export function WorkspaceAppShellProvider(props: Readonly<{ children: React.ReactNode }>) {
    const catalog = useCompactAppDestinations();
    const enabled = useWorkspaceShellEnabled();
    return <WorkspaceProvider enabled={enabled} catalog={catalog}>{props.children}</WorkspaceProvider>;
}
