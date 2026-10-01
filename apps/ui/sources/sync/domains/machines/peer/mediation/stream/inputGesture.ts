import type { SimulatorOrientationV1, SimulatorPreviewRectV1 } from '@happier-dev/protocol';

/**
 * One viewer gesture on a live-stream surface, before it becomes a source's sideband control.
 *
 * The gesture interpretation (tap vs long press vs swipe vs pinch, keyboard) is the same whatever
 * the stream shows — a simulator or the agent's browser — so it has one owner
 * (`components/stream/LiveStreamInputLayer`). Each source kind maps a gesture to its controls:
 * the simulator through its lease-scoped device geometry builder, the browser straight to the
 * registered source's normalized controls.
 */
export type LiveStreamGestureGeometry = Readonly<{
    orientation: SimulatorOrientationV1;
    viewport: Readonly<{ width: number; height: number }>;
    content: SimulatorPreviewRectV1;
}>;

export type LiveStreamPoint = Readonly<{ x: number; y: number }>;

export type LiveStreamInputGesture =
    | (Readonly<{ kind: 'tap'; point: LiveStreamPoint }> & LiveStreamGestureGeometry)
    | (Readonly<{ kind: 'long_press'; point: LiveStreamPoint; durationMs?: number }> & LiveStreamGestureGeometry)
    | (Readonly<{ kind: 'swipe' | 'drag'; from: LiveStreamPoint; to: LiveStreamPoint; durationMs?: number }> & LiveStreamGestureGeometry)
    | (Readonly<{
        kind: 'pinch';
        center: LiveStreamPoint;
        startDistance: number;
        endDistance: number;
        angle?: number;
        durationMs?: number;
    }> & LiveStreamGestureGeometry)
    | (Readonly<{
        kind: 'rotate';
        center: LiveStreamPoint;
        radius: number;
        startAngle: number;
        endAngle: number;
        durationMs?: number;
    }> & LiveStreamGestureGeometry)
    | Readonly<{ kind: 'keyboard_text'; text: string }>
    | Readonly<{ kind: 'keyboard_key'; key: string }>;

/**
 * A viewport-normalized point (0..1 of the viewer surface) re-expressed in the drawn content rect
 * (0..1 of the picture), or `null` when it falls outside the picture.
 */
export function mapLiveStreamPointToContent(input: Readonly<{
    point: LiveStreamPoint;
    viewport: Readonly<{ width: number; height: number }>;
    content: SimulatorPreviewRectV1;
}>): LiveStreamPoint | null {
    const { viewport, content } = input;
    if (!(viewport.width > 0 && viewport.height > 0 && content.width > 0 && content.height > 0)) return null;
    const x = (input.point.x * viewport.width - content.x) / content.width;
    const y = (input.point.y * viewport.height - content.y) / content.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
}
