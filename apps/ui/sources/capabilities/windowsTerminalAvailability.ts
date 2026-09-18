import type { CapabilitiesDetectResponse } from '@/sync/api/capabilities/capabilitiesProtocol';

/** The incumbent New Session interpretation of the Windows Terminal probe. */
export function resolveWindowsTerminalAvailable(params: Readonly<{
    targetIsWindows: boolean;
    response: CapabilitiesDetectResponse | undefined;
}>): boolean {
    if (!params.targetIsWindows) return false;
    const result = params.response?.results['tool.windowsTerminal'];
    if (result?.ok !== true) return false;
    const data = result.data;
    return !!data && typeof data === 'object' && 'available' in data && data.available === true;
}
