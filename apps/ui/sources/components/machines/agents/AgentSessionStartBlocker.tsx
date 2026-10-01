import * as React from 'react';

import type { MachineAgent } from '@/agents/machineAgents/machineAgentTypes';
import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { t } from '@/text';

import { resolveAgentSessionStartBlock } from './machineAgentPresentation';


export const AgentSessionStartBlocker = React.memo(function AgentSessionStartBlocker(props: Readonly<{
    agent: MachineAgent | null;
    machineName: string;
    /** Opens the agent's setup (the engine popover's form, or the machine's Agents section). */
    onSetUp: (agent: MachineAgent) => void;
}>) {
    const block = resolveAgentSessionStartBlock(props.agent);
    if (!block || !props.agent) return null;
    const agent = props.agent;
    return (
        <AttentionBanner
            testID="new-session-agent-blocker"
            tone="warning"
            title={block === 'notInstalled'
                ? t('machineAgents.blockNotInstalled', { agent: agent.title, machine: props.machineName })
                : t('machineAgents.blockSignedOut', { agent: agent.title, machine: props.machineName })}
            description={block === 'notInstalled' ? t('machineAgents.blockSetUpToStart') : undefined}
            action={{
                label: block === 'notInstalled' ? t('machineAgents.setUp') : t('machineAgents.actionSignIn'),
                onPress: () => props.onSetUp(agent),
                testID: 'new-session-agent-blocker.action',
            }}
        />
    );
});
