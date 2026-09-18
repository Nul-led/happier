import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskSpec } from '@happier-dev/protocol';

import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';

/**
 * Builds the `setup.thisComputer.v1` spec for a desktop-initiated local setup run.
 *
 * The relay pair is **required**: the executor falls back to whatever relay the local CLI happens
 * to have selected when a task supplies no explicit target, so a caller that omits it would
 * silently configure this computer's background service for the wrong Home. Requiring it here
 * makes that omission a compile error at every UI caller. The terminal-initiated `hsetup` path,
 * which legitimately has no app selection to send, keeps the executor's ambient fallback.
 */
export function buildLocalMachineSetupSystemTaskSpec(params: Readonly<{
    activeRelayUrl: string;
    activeWebappUrl: string;
    activeLocalRelayUrl?: string | null;
    installService?: boolean;
    startService?: boolean;
    verifyService?: boolean;
}>): SystemTaskSpec {
    const channel = resolvePreferredPublicReleaseRingLabelForCurrentApp();
    return {
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        kind: 'setup.thisComputer.v1',
        params: {
            surface: 'desktop.ui',
            target: 'thisComputer',
            channel,
            ...(typeof params.activeRelayUrl === 'string' && params.activeRelayUrl.trim().length > 0
                ? { activeRelayUrl: params.activeRelayUrl.trim() }
                : {}),
            ...(typeof params.activeWebappUrl === 'string' && params.activeWebappUrl.trim().length > 0
                ? { activeWebappUrl: params.activeWebappUrl.trim() }
                : {}),
            ...(params.activeLocalRelayUrl === null
                ? { activeLocalRelayUrl: null }
                : (typeof params.activeLocalRelayUrl === 'string' && params.activeLocalRelayUrl.trim().length > 0
                    ? { activeLocalRelayUrl: params.activeLocalRelayUrl.trim() }
                    : {})),
            ...(typeof params.installService === 'boolean' ? { installService: params.installService } : {}),
            ...(typeof params.startService === 'boolean' ? { startService: params.startService } : {}),
            ...(typeof params.verifyService === 'boolean' ? { verifyService: params.verifyService } : {}),
        },
    };
}
