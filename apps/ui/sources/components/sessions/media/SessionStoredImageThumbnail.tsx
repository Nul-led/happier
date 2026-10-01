import * as React from 'react';

import { SessionMediaInlineImages } from '@/components/sessions/media/SessionMediaInlineImages';
import { getStorage } from '@/sync/domains/state/storage';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';

/**
 * A Session image, read from whichever store holds it: the Session's working directory, or the
 * Session media store a daemon keeps under its own home directory (W2B writes those with
 * `storage: 'daemon'`, relative to that home, as the CLI's trusted image reader resolves them). The
 * caller names the machine whose daemon stored it (the Session's machine for the managed browser, the
 * shared window's machine for computer use).
 */
export function SessionStoredImageThumbnail(props: Readonly<{
    sessionId: string;
    serverId: string | null;
    /** The machine whose daemon stored a `daemon` image; unused for Session-workspace images. */
    machineId: string | null;
    storage: 'session' | 'daemon';
    media: React.ComponentProps<typeof SessionMediaInlineImages>['media'];
    mediaPreviewEnabled: boolean;
    testID: string;
}>): React.ReactElement | null {
    const daemonStored = props.storage === 'daemon';
    const serverId = usePreferredServerIdForSession({ sessionId: props.sessionId, serverId: props.serverId });
    const machineId = daemonStored ? props.machineId : null;
    // That server's machine record (not the active server's): the daemon reports its home in metadata.
    const daemonHome = getStorage()((state) => (machineId && serverId
        ? state.machineListByServerId?.[serverId]?.find((candidate) => candidate.id === machineId)?.metadata?.happyHomeDir ?? null
        : null));
    const workspaceScope = React.useMemo(() => (daemonStored && serverId && machineId && daemonHome
        ? { serverId, machineId, rootPath: daemonHome }
        : null), [daemonHome, daemonStored, machineId, serverId]);
    // A daemon image whose machine this client cannot name has no readable root: show nothing rather
    // than a tile that can only fail.
    if (daemonStored && !workspaceScope) return null;
    return (
        <SessionMediaInlineImages
            sessionId={props.sessionId}
            workspaceScope={workspaceScope}
            media={props.media}
            onOpenPath={() => undefined}
            fileOpenEnabled={false}
            mediaPreviewEnabled={props.mediaPreviewEnabled}
            testIdPrefix={props.testID}
        />
    );
}
