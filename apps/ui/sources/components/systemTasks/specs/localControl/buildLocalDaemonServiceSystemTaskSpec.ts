import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskSpec } from '@happier-dev/protocol';
import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';

/**
 * The kinds hsetup parses with `parseDaemonServiceTaskParams`: the local background service, and
 * the PATH exposure the same setup run performs. One builder keeps a single owner for these params
 * rather than a second copy that can drift.
 */
type LocalDaemonServiceTaskKind =
    | 'daemon.service.status.v1'
    | 'daemon.service.start.v1'
    | 'daemon.service.stop.v1'
    | 'daemon.service.restart.v1'
    | 'cli.pathExposure.ensure.v1'
    | 'cli.pathExposure.remove.v1';

const LOCAL_DAEMON_SERVICE_PARAMS = {
    target: { kind: 'local' as const },
    surface: 'desktop.ui' as const,
    mode: 'user' as const,
};

export function buildLocalDaemonServiceSystemTaskSpec(kind: LocalDaemonServiceTaskKind): SystemTaskSpec {
    const channel = resolvePreferredPublicReleaseRingLabelForCurrentApp();
    return {
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        kind,
        params: {
            ...LOCAL_DAEMON_SERVICE_PARAMS,
            channel,
        },
    };
}
