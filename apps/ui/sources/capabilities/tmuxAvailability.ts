import type { CapabilitiesDetectResponse, TmuxCapabilityData } from '@/sync/api/capabilities/capabilitiesProtocol';

/** The incumbent machine-page and New Session interpretation of the tmux tool probe. */
export function resolveTmuxAvailable(response: CapabilitiesDetectResponse | undefined): boolean | null {
    const result = response?.results['tool.tmux'];
    if (!result || !result.ok) return null;
    const data = result.data as Partial<TmuxCapabilityData> | undefined;
    return typeof data?.available === 'boolean' ? data.available : null;
}
