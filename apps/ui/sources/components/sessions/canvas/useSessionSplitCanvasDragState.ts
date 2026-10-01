import * as React from 'react';
import { Platform } from 'react-native';

import { SESSION_SPLIT_CANVAS_DRAG_STATE_EVENT, type SessionSplitCanvasDragStateDetail } from './sessionSplitCanvasDragState';

const IDLE: SessionSplitCanvasDragStateDetail = { active: false };

/** The current Session drag, from the drag source's own events; idle off the web. */
function useSessionSplitCanvasDragDetail(): SessionSplitCanvasDragStateDetail {
    const [detail, setDetail] = React.useState<SessionSplitCanvasDragStateDetail>(IDLE);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') {
            return;
        }

        const handleDragState = (event: Event) => {
            const next = (event as CustomEvent<SessionSplitCanvasDragStateDetail>).detail;
            setDetail(next?.active === true
                ? (next.sessionId ? { active: true, sessionId: next.sessionId } : { active: true })
                : IDLE);
        };

        const handleWindowDragEnd = () => {
            setDetail(IDLE);
        };

        window.addEventListener(SESSION_SPLIT_CANVAS_DRAG_STATE_EVENT, handleDragState as EventListener);
        window.addEventListener('dragend', handleWindowDragEnd);
        window.addEventListener('drop', handleWindowDragEnd);

        return () => {
            window.removeEventListener(SESSION_SPLIT_CANVAS_DRAG_STATE_EVENT, handleDragState as EventListener);
            window.removeEventListener('dragend', handleWindowDragEnd);
            window.removeEventListener('drop', handleWindowDragEnd);
        };
    }, []);

    return detail;
}

export function useSessionSplitCanvasDragState(): boolean {
    return useSessionSplitCanvasDragDetail().active;
}

/** The Session being dragged right now, or `null` when no Session drag is active. */
export function useSessionSplitCanvasDraggedSessionId(): string | null {
    const detail = useSessionSplitCanvasDragDetail();
    return detail.active ? (detail.sessionId ?? null) : null;
}
