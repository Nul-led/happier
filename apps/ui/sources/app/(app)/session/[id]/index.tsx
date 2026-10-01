import * as React from 'react';
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import { SessionDestinationBody } from '@/components/sessions/shell/SessionDestinationBody';

export default function SessionRouteEntry() {
    return <WorkspaceRouteEntry Body={SessionDestinationBody} />;
}
