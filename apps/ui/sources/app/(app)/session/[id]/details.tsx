import * as React from 'react';
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import { SessionDetailsDestinationBody } from '@/components/sessions/shell/SessionDetailsDestinationBody';

export default function SessionDetailsRouteEntry() {
    return <WorkspaceRouteEntry Body={SessionDetailsDestinationBody} />;
}
