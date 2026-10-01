import { homeConnectServiceStepId } from '../home/selectHomeConnectInvitations';
import type { ConnectedServiceSetupCatalogEntry, ConnectedServiceSetupTarget } from './ConnectedServiceSetupPanel';

/** The "More services" / "API keys, code hosts and tools" block that grows into the whole catalog. */
export const CONNECT_MORE_BROWSE_ID = '__browse';

/** Whether a service signs in with an account (a plan people pay for) rather than a pasted key. */
export function signsInWithAnAccount(entry: Pick<ConnectedServiceSetupCatalogEntry, 'entry'>): boolean {
    const modes = entry.entry?.authenticationModes ?? entry.entry?.projectedDescriptor?.authentication.modes ?? [];
    return modes.some((mode) => mode.kind === 'oauthAuthorizationCode' || mode.kind === 'oauthDeviceCode');
}

/**
 * What "Connect more" offers as its own blocks (lab `csvc` A1, P0). On the page: the services the agents
 * on your machines accept that nobody connected yet and nobody set aside ("Not now" is the Home set-up
 * dismissal `connect:<service>`). On first run: the plans people sign in with (keys wait). Everything
 * else addable is behind the browse block.
 */
export function selectConnectMoreOffer(input: Readonly<{
    layout: 'section' | 'firstRun';
    addable: readonly ConnectedServiceSetupCatalogEntry[];
    /** The index's services without an account (its G3 list). */
    connectableKeys: ReadonlySet<string>;
    hidden: ReadonlySet<string>;
}>): Readonly<{ offered: readonly ConnectedServiceSetupCatalogEntry[]; browse: boolean }> {
    const agentServices = input.addable.filter((entry) => entry.section === 'agents' && input.connectableKeys.has(entry.serviceKey));
    const offered = input.layout === 'section'
        ? agentServices.filter((entry) => entry.usedBy.length > 0 && !input.hidden.has(homeConnectServiceStepId(entry.serviceKey)))
        : agentServices.some(signsInWithAnAccount) ? agentServices.filter(signsInWithAnAccount) : agentServices;
    return { offered, browse: input.addable.length > offered.length };
}

/**
 * Which block a request opens (the page's "+", "Add account", "Sign in again"): a service's own block
 * when it has one, else the browse block (the panel then goes straight to the service's flow). An open
 * panel stays where it is and follows the new target.
 */
export function resolveConnectMoreBlockForRequest(input: Readonly<{
    request: ConnectedServiceSetupTarget;
    offered: readonly Pick<ConnectedServiceSetupCatalogEntry, 'serviceKey'>[];
    browse: boolean;
    openId: string | null;
}>): string | null {
    if (input.openId) return input.openId;
    const { request } = input;
    if (request.kind === 'service' && input.offered.some((entry) => entry.serviceKey === request.serviceKey)) return request.serviceKey;
    return input.browse ? CONNECT_MORE_BROWSE_ID : input.offered[0]?.serviceKey ?? null;
}
