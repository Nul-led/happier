import * as React from 'react';
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import { AgentSettingsScreen } from '@/components/settings/agents/AgentSettingsScreen';

export { AgentSettingsScreen as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AgentSettingsScreen} />; }
