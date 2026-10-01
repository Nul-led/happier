import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { AgentSetupSpecimen } from '@/components/dev/agentSetup/AgentSetupSpecimen';

/** Dev-only: the agent-setup surfaces with fixture agents (lab `agent-setup`). `?frame=<id>`. */
export default function AgentSetupDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return <AgentSetupSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />;
}
