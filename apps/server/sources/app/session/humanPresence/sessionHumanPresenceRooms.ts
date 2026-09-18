import type { SessionHumanPresenceLocationV1 } from "@happier-dev/protocol/sessions";

const PREFIX = "session-human-presence:";
const DISCUSSION_PREFIX = "session-human-presence-discussion:";

export function sessionHumanPresenceRoom(sessionId: string): string {
    return `${PREFIX}${sessionId}`;
}

export function sessionDiscussionHumanPresenceRoom(location: SessionHumanPresenceLocationV1): string {
    return `${DISCUSSION_PREFIX}${encodeURIComponent(location.sessionId)}:${encodeURIComponent(location.discussionId)}`;
}

export function sessionHumanPresenceLocationRoom(location: Readonly<{
    sessionId: string;
    discussionId?: string;
}>): string {
    return location.discussionId === undefined
        ? sessionHumanPresenceRoom(location.sessionId)
        : sessionDiscussionHumanPresenceRoom({ sessionId: location.sessionId, discussionId: location.discussionId });
}

export function sessionHumanPresenceLocationFromRoom(room: string): Readonly<{
    sessionId: string;
    discussionId?: string;
}> | null {
    if (room.startsWith(DISCUSSION_PREFIX)) {
        const encoded = room.slice(DISCUSSION_PREFIX.length);
        const separator = encoded.indexOf(":");
        if (separator < 0) return null;
        try {
            return {
                sessionId: decodeURIComponent(encoded.slice(0, separator)),
                discussionId: decodeURIComponent(encoded.slice(separator + 1)),
            };
        } catch {
            return null;
        }
    }
    return room.startsWith(PREFIX) ? { sessionId: room.slice(PREFIX.length) } : null;
}

export function sessionHumanPresenceLocationsFromRooms(rooms: Iterable<string>): Array<Readonly<{
    sessionId: string;
    discussionId?: string;
}>> {
    return [...rooms]
        .map(sessionHumanPresenceLocationFromRoom)
        .filter((location): location is Readonly<{ sessionId: string; discussionId?: string }> => location !== null)
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId)
            || (left.discussionId ?? "").localeCompare(right.discussionId ?? ""));
}

export function sessionIdsFromHumanPresenceRooms(rooms: Iterable<string>): string[] {
    return sessionHumanPresenceLocationsFromRooms(rooms)
        .filter((location) => location.discussionId === undefined)
        .map((location) => location.sessionId);
}
