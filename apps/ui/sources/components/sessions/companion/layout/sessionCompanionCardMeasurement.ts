import * as React from 'react';

export type SessionCompanionCardBounds = Readonly<{
    widthPx: number;
    heightPx: number;
}>;

type MeasurementIdentity = Readonly<{
    sessionId: string;
    serverId: string | null;
    paneScopeId: string;
    density: 'compact' | 'comfortable';
    fontScale: number;
}>;

const boundsByIdentity = new Map<string, SessionCompanionCardBounds>();
const listenersByIdentity = new Map<string, Set<() => void>>();

function identityKey(identity: MeasurementIdentity): string {
    return JSON.stringify([
        identity.sessionId,
        identity.serverId,
        identity.paneScopeId,
        identity.density,
        identity.fontScale,
    ]);
}

function normalizeBounds(bounds: SessionCompanionCardBounds): SessionCompanionCardBounds | null {
    const widthPx = Math.ceil(bounds.widthPx);
    const heightPx = Math.ceil(bounds.heightPx);
    if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) return null;
    return Object.freeze({ widthPx, heightPx });
}

/**
 * Publishes the outer rail bounds derived from layout React Native actually
 * produced inside the reserved rail.
 * This is ephemeral presentation measurement only: it is never persisted and
 * carries no item identity, content or authority. A stretched full-screen card
 * is deliberately not published here: its container width is not evidence of
 * the card width a rail would need.
 */
export function publishSessionCompanionCardBounds(
    identity: MeasurementIdentity,
    bounds: SessionCompanionCardBounds,
): void {
    const next = normalizeBounds(bounds);
    if (!next) return;
    const key = identityKey(identity);
    const current = boundsByIdentity.get(key);
    if (current?.widthPx === next.widthPx && current.heightPx === next.heightPx) return;
    boundsByIdentity.set(key, next);
    for (const listener of listenersByIdentity.get(key) ?? []) listener();
}

export function useSessionCompanionCardBounds(
    identity: MeasurementIdentity,
): SessionCompanionCardBounds | null {
    const key = React.useMemo(() => identityKey(identity), [
        identity.density,
        identity.fontScale,
        identity.paneScopeId,
        identity.sessionId,
        identity.serverId,
    ]);
    return React.useSyncExternalStore(
        React.useCallback((listener) => {
            const listeners = listenersByIdentity.get(key) ?? new Set<() => void>();
            listeners.add(listener);
            listenersByIdentity.set(key, listeners);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    listenersByIdentity.delete(key);
                    boundsByIdentity.delete(key);
                }
            };
        }, [key]),
        React.useCallback(() => boundsByIdentity.get(key) ?? null, [key]),
        () => null,
    );
}
