import * as React from 'react';

import { cancelAgentInstallJob, startAgentInstallJob } from '@/agents/machineAgents/installJobs/installJobStore';
import type { MachineAgent } from '@/agents/machineAgents/machineAgentTypes';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { useServerCredentialAccountScopeBinding } from '@/sync/domains/scope/useServerCredentialAccountScopes';

import type { MachineAgentRowAction } from './machineAgentPresentation';
import { showAgentSignInTerminalSheet } from './AgentSignInTerminalSheet';
import { useAgentSignInTerminalHost } from './signInTerminalHost';

/**
 * What a row's or card's one action does, on every surface: install / update / try again start the
 * daemon job, Cancel stops it, Sign in opens the agent's form (where the way to sign in is chosen),
 * Show terminal brings its sign-in terminal back, Setup guide opens the vendor's guide. `onOpenForm` is
 * the surface's way to show the form (expand the row, open the machine page).
 */
export function useMachineAgentRowActions(input: Readonly<{
    serverId: string;
    machineId: string;
    machineName: string;
    onOpenForm: (agent: MachineAgent) => void;
}>): (agent: MachineAgent, action: MachineAgentRowAction) => void {
    const terminalHost = useAgentSignInTerminalHost();
    const { serverId, machineId, machineName, onOpenForm } = input;
    const { binding } = useServerCredentialAccountScopeBinding(serverId);
    return React.useCallback((agent, action) => {
        const target = { serverId, machineId, agentId: agent.agentId };
        switch (action.kind) {
            case 'install':
            case 'retry':
            case 'update':
                if (!binding?.isCurrent()) return;
                fireAndForget(startAgentInstallJob({ ...target, ...binding.scope }, action.kind === 'update' || agent.job?.intent === 'update' ? 'update' : 'install', {
                    // The row said what it installs and whose installer runs; pressing it is the consent.
                    consent: { vendorRecipe: agent.install.requiresVendorConsent },
                }), { tag: 'machineAgentRowAction.install' });
                onOpenForm(agent);
                return;
            case 'cancel':
                if (!binding?.isCurrent()) return;
                fireAndForget(cancelAgentInstallJob({ ...target, ...binding.scope }), { tag: 'machineAgentRowAction.cancel' });
                return;
            case 'signIn':
                onOpenForm(agent);
                return;
            case 'showTerminal': {
                const terminalTarget = { ...target, machineName, agentTitle: agent.title };
                if (terminalHost) terminalHost.open(terminalTarget);
                else showAgentSignInTerminalSheet(terminalTarget);
                return;
            }
            case 'guide':
                fireAndForget(openExternalUrl(action.url), { tag: 'machineAgentRowAction.guide' });
                return;
        }
    }, [binding, machineId, machineName, onOpenForm, serverId, terminalHost]);
}
