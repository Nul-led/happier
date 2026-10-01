import * as React from 'react';

/** Which agent's native sign-in to show, on which machine. */
export type AgentSignInTerminalTarget = Readonly<{
    serverId: string | null;
    machineId: string;
    machineName: string;
    agentId: string;
    agentTitle: string;
}>;

export type AgentSignInTerminalHost = Readonly<{
    /** Shows the sign-in terminal for this agent (the page's bottom pane, or the modal sheet). */
    open: (target: AgentSignInTerminalTarget) => void;
}>;

const HostContext = React.createContext<AgentSignInTerminalHost | null>(null);

/**
 * A page that has a bottom pane (the machine page, Settings → Agents) provides this, so an agent's own
 * sign-in opens in its terminal pane (lab T1). Surfaces without one (Home's composer popover, phones)
 * fall back to the same view in a sheet (`AgentSignInTerminalSheet`), which the caller passes as
 * `fallback`.
 */
export function AgentSignInTerminalHostProvider(props: Readonly<{ host: AgentSignInTerminalHost; children: React.ReactNode }>) {
    return <HostContext.Provider value={props.host}>{props.children}</HostContext.Provider>;
}

export function useAgentSignInTerminalHost(): AgentSignInTerminalHost | null {
    return React.useContext(HostContext);
}
