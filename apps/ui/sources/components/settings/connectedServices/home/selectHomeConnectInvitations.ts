import type { ConnectedServicesIndexConnectable } from '../model/buildConnectedServicesIndexModel';

/** The dismissal ids on the Account's Home layout (restorable from Customize → Hidden setup steps). */
export const HOME_CONNECT_INVITATION_STEP_ID = 'connect-accounts';
export function homeConnectServiceStepId(serviceKey: string): string {
    return `connect:${serviceKey}`;
}

type Invitable = Pick<ConnectedServicesIndexConnectable, 'serviceKey' | 'usedBy'>;

export type HomeConnectInvitations<S extends Invitable> =
    | Readonly<{ kind: 'none' }>
    /** Before any account: the section's empty state invites with every service your agents accept (H1). */
    | Readonly<{ kind: 'invite'; services: readonly S[] }>
    /** After an account: one dashed card for the next service an agent accepts (H1b). */
    | Readonly<{ kind: 'next'; service: S }>;

/**
 * What the Home Usage section offers to connect (lab `csvc` H1/H1b, G3/G4): only services an agent on
 * your machines accepts, never code hosts; "Not now" skips one service, "Hide" the whole invitation.
 * It leaves when every such service is connected or dismissed. Hiding it never hides usage.
 */
export function selectHomeConnectInvitations<S extends Invitable>(input: Readonly<{
    connectable: readonly S[];
    hidden: ReadonlySet<string>;
    hasAccounts: boolean;
}>): HomeConnectInvitations<S> {
    if (input.hidden.has(HOME_CONNECT_INVITATION_STEP_ID)) return { kind: 'none' };
    const services = input.connectable.filter((service) => (
        // Only what an agent is known to accept: without that fact (no cached agent projection) Home
        // stays quiet rather than guess, and code hosts never qualify.
        service.usedBy.length > 0 && !input.hidden.has(homeConnectServiceStepId(service.serviceKey))
    ));
    if (services.length === 0) return { kind: 'none' };
    return input.hasAccounts ? { kind: 'next', service: services[0]! } : { kind: 'invite', services };
}
