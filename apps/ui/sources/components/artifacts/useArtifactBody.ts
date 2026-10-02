import * as React from 'react';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';

export type ArtifactBodyState = 'ready' | 'loading' | 'failed';

/** The opened artifact's body: the store's when it holds one, else read once for this view. */
export function useArtifactBody(artifactId: string, artifact: DecryptedArtifact | null): Readonly<{ state: ArtifactBodyState; retry: () => void }> {
    const needsBody = artifact !== null && artifact.isDecrypted !== false && artifact.body === undefined;
    const [state, setState] = React.useState<ArtifactBodyState>(needsBody ? 'loading' : 'ready');
    const [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
        if (!needsBody) { setState('ready'); return; }
        let current = true;
        setState('loading');
        void sync.fetchArtifactWithBody(artifactId).then((full) => {
            if (!current) return;
            if (full) storage.getState().updateArtifact(full);
            setState(full ? 'ready' : 'failed');
        }, () => { if (current) setState('failed'); });
        return () => { current = false; };
    }, [artifactId, needsBody, attempt]);
    return { state, retry: React.useCallback(() => setAttempt((value) => value + 1), []) };
}
