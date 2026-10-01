import type { MachineAgentInventoryItem } from '@happier-dev/protocol/capabilities';
import type { MachineAgent, MachineAgentConnectedService, MachineAgentSignIn } from './machineAgentTypes';
import { resolveMachineAgentState } from './resolveMachineAgentState';

const NATIVE_LOGIN = { login_terminal: 'terminal', status_only: 'statusOnly', manual_only: 'manual', unsupported: 'unsupported' } as const;

export function resolveMachineAgentSignIn(input: Readonly<{
    native: MachineAgentInventoryItem['signIn'];
    connectedServices: readonly MachineAgentConnectedService[];
}>): MachineAgentSignIn {
    const connected = input.connectedServices.find((service) => service.connected && service.healthy);
    return {
        status: connected ? 'signedIn' : input.native.status,
        via: connected
            ? { kind: 'connected', serviceId: connected.serviceId, title: connected.title, profileLabel: connected.profileLabel }
            : input.native.status === 'signedIn' ? { kind: 'native', accountLabel: input.native.accountLabel ?? null } : null,
        nativeLogin: NATIVE_LOGIN[input.native.loginSupport],
        connectedServices: input.connectedServices,
    };
}

export function projectMachineAgent(input: Readonly<{
    agentId: string;
    title: string;
    facts: MachineAgentInventoryItem | null;
    checking: boolean;
    stale: boolean;
    connectedServices: readonly MachineAgentConnectedService[];
    job: MachineAgent['job'];
    dependencyTitlesByKey?: Readonly<Record<string, string>>;
}>): MachineAgent {
    const facts = input.facts;
    const agent = {
        agentId: input.agentId, title: input.title,
        installed: facts?.installed ?? false,
        version: facts?.version ?? null, latestVersion: facts?.latestVersion ?? null,
        update: facts?.update ?? null,
        signIn: resolveMachineAgentSignIn({ native: facts?.signIn ?? { status: 'unknown', loginSupport: 'unsupported' }, connectedServices: input.connectedServices }),
        platform: facts?.platform ?? { supported: true as const },
        install: { ...(facts?.install ?? { available: false, mode: 'none' as const, sizeBytes: null, guideUrl: null }), requiresVendorConsent: facts?.install.mode === 'vendor_recipe' },
        dependencies: (facts?.dependencies ?? []).map((dependency) => ({ ...dependency, title: input.dependencyTitlesByKey?.[dependency.key] ?? dependency.key })),
        job: input.job, stale: input.stale,
    };
    return { ...agent, state: resolveMachineAgentState({ ...agent, known: facts !== null, checking: input.checking }) };
}

/** Keep unchanged agent rows and nested facts stable across refresh and unrelated agent updates. */
export function reconcileMachineAgents(previous: readonly MachineAgent[], incoming: readonly MachineAgent[]): readonly MachineAgent[] {
    const previousById = new Map(previous.map((agent) => [agent.agentId, agent]));
    const reconciled = incoming.map((agent) => {
        const prior = previousById.get(agent.agentId);
        return prior && JSON.stringify(prior) === JSON.stringify(agent) ? prior : agent;
    });
    return previous.length === reconciled.length && reconciled.every((agent, index) => agent === previous[index]) ? previous : reconciled;
}
