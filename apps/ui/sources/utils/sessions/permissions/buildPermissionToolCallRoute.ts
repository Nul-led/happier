import type { PermissionToolCallMessageLocation } from './permissionToolCallLocationTypes';
import { isStableSessionMessageRouteId } from '@/sync/domains/messages/messageRouteIds';

function encodeRouteSegment(value: string): string {
    return encodeURIComponent(value);
}

export function buildPermissionToolCallRoute(params: Readonly<{
    sessionId: string;
    serverId?: string;
    location: PermissionToolCallMessageLocation | null;
}>): string {
    const sessionId = params.sessionId.trim();
    const location = params.location;
    const withServerScope = (route: string): string => {
        if (params.serverId === undefined) return route;
        return `${route}${route.includes('?') ? '&' : '?'}serverId=${encodeURIComponent(params.serverId)}`;
    };

    if (!location) {
        return withServerScope(`/session/${encodeRouteSegment(sessionId)}`);
    }

    if (location.kind === 'top' && typeof location.seq === 'number') {
        return withServerScope(`/session/${encodeRouteSegment(sessionId)}?jumpSeq=${location.seq}`);
    }

    if (location.kind === 'top') {
        return withServerScope(`/session/${encodeRouteSegment(sessionId)}/message/${encodeRouteSegment(location.messageId)}`);
    }

    return withServerScope(`/session/${encodeRouteSegment(sessionId)}/message/${encodeRouteSegment(location.parentMessageId)}?jumpChildId=${encodeRouteSegment(location.messageId)}`);
}

export function canOpenPermissionToolCallRoute(location: PermissionToolCallMessageLocation | null): boolean {
    if (!location) return false;

    if (location.kind === 'top') {
        return typeof location.seq === 'number' || isStableSessionMessageRouteId(location.messageId);
    }

    return (
        isStableSessionMessageRouteId(location.parentMessageId)
        && isStableSessionMessageRouteId(location.messageId)
    );
}
