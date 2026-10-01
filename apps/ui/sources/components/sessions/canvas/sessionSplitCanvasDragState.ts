export const SESSION_SPLIT_CANVAS_DRAG_STATE_EVENT = 'happier:session-split-canvas-drag-state';

export type SessionSplitCanvasDragStateDetail = Readonly<{
    active: boolean;
    /**
     * The Session being dragged, while active. A drop target reads it during
     * the drag (the `text/plain` payload is readable only on drop) to state
     * what a drop would do before the person lets go.
     */
    sessionId?: string;
}>;

export function emitSessionSplitCanvasDragState(active: boolean, sessionId?: string): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent<SessionSplitCanvasDragStateDetail>(SESSION_SPLIT_CANVAS_DRAG_STATE_EVENT, {
        detail: active && sessionId ? { active, sessionId } : { active },
    }));
}
