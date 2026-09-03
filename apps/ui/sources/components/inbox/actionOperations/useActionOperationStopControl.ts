import * as React from 'react';
import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { requestActionOperationStop } from './requestActionOperationStop';

export function useActionOperationStopControl(operation: ActionOperationSnapshotV1 | null | undefined) {
    const mountedRef = React.useRef(true);
    const [pending, setPending] = React.useState(false);
    const [feedback, setFeedback] = React.useState<
        'requested' | 'unsupported' | 'already_settled' | 'not_found' | 'failed' | null
    >(null);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const requestStop = React.useCallback(() => {
        if (!operation || pending) return;
        setPending(true);
        setFeedback(null);
        void requestActionOperationStop(operation)
            .then((result) => {
                if (mountedRef.current) setFeedback(result.kind);
            })
            .catch(() => {
                if (mountedRef.current) setFeedback('failed');
            })
            .finally(() => {
                if (mountedRef.current) setPending(false);
            });
    }, [operation, pending]);

    return { pending, feedback, requestStop } as const;
}
