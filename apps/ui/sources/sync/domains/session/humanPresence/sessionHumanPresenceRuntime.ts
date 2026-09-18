import { sessionAddressKey, type SessionAddress } from '../sessionAddress';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import {
    SessionHumanPresenceVisibleReplaceResultV1Schema,
    SESSION_HUMAN_PRESENCE_VISIBLE_REPLACE_EVENT as VISIBLE_EVENT,
    SESSION_HUMAN_PRESENCE_TYPING_SET_EVENT as TYPING_EVENT,
} from '@happier-dev/protocol/sessions';
import { getVisibleSessionSurfaces, subscribeSessionSurfaceVisibility } from '../sessionSurfaceVisibility';
import { readHostActivelyViewed, subscribeToHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';
import { sessionHumanPresenceStore, type SessionHumanPresenceTarget } from './sessionHumanPresenceStore';

export type SessionHumanPresenceSocketTransport = Readonly<{
    isConnected(): boolean;
    subscribeStatus(listener: () => void): () => void;
    sendWithAck(event: string, payload: unknown): Promise<unknown>;
    send(event: string, payload: unknown): void;
    subscribeSnapshot(listener: (payload: unknown) => void): () => void;
}>;

type DiscussionTarget = SessionAddress & Readonly<{ discussionId: string }>;
type Attachment = {
    dispose(preserveObservation?: boolean): void;
    publish(): void;
    edit(target: SessionHumanPresenceTarget, nonEmpty: boolean): void;
    stop(target?: SessionHumanPresenceTarget): void;
};
const homes = new Map<string, Attachment>();
const discussionLocations = new Map<string, { target: DiscussionTarget; count: number }>();
let detachVisibility: (() => void) | null = null;

const targetKey = (target: SessionHumanPresenceTarget) => `${sessionAddressKey(target)}\u0000${target.discussionId ?? ''}`;

/** Registers one visible discussion through the existing per-Home replace-set owner. */
export function registerSessionDiscussionHumanPresence(target: DiscussionTarget): () => void {
    const normalized = { ...target, serverId: resolveServerProfileScopeIdForIdentifier(target.serverId) };
    const key = targetKey(normalized);
    const current = discussionLocations.get(key);
    discussionLocations.set(key, { target: normalized, count: (current?.count ?? 0) + 1 });
    homes.get(normalized.serverId)?.publish();
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const entry = discussionLocations.get(key);
        if (!entry) return;
        if (entry.count > 1) discussionLocations.set(key, { ...entry, count: entry.count - 1 });
        else discussionLocations.delete(key);
        homes.get(normalized.serverId)?.publish();
    };
}

export function reportSessionTypingEdit(address: SessionAddress, nonEmpty: boolean): void {
    const serverId = resolveServerProfileScopeIdForIdentifier(address.serverId);
    homes.get(serverId)?.edit({ ...address, serverId }, nonEmpty);
}
export function stopSessionTyping(address: SessionAddress): void {
    const serverId = resolveServerProfileScopeIdForIdentifier(address.serverId);
    homes.get(serverId)?.stop({ ...address, serverId });
}
export function reportSessionDiscussionTypingEdit(target: DiscussionTarget, nonEmpty: boolean): void {
    const serverId = resolveServerProfileScopeIdForIdentifier(target.serverId);
    homes.get(serverId)?.edit({ ...target, serverId }, nonEmpty);
}
export function stopSessionDiscussionTyping(target: DiscussionTarget): void {
    const serverId = resolveServerProfileScopeIdForIdentifier(target.serverId);
    homes.get(serverId)?.stop({ ...target, serverId });
}

export function attachSessionHumanPresenceSocket(input: Readonly<{
    serverId: string;
    accountId: string;
    transport: SessionHumanPresenceSocketTransport;
}>): () => void {
    const { accountId, transport } = input;
    const serverId = resolveServerProfileScopeIdForIdentifier(input.serverId);
    homes.get(serverId)?.dispose(true);
    let handle = sessionHumanPresenceStore.attachHome(serverId, accountId);
    let connected = false;
    let disposed = false;
    let generation = 0;
    let support: 'unknown' | 'supported' | 'unavailable' = 'unknown';
    let pending = false;
    let signature: string | null = null;
    let unacknowledgedDeclarationMayBeApplied = false;
    let admitted = new Set<string>();
    let admittedLocations = new Set<string>();
    let discussionSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown';
    let typing: {target: SessionHumanPresenceTarget; renewedAt: number; timer: ReturnType<typeof setTimeout>} | null = null;
    const currentLocations = (): DiscussionTarget[] => readHostActivelyViewed()
        ? [...discussionLocations.values()].map((entry) => entry.target)
            .filter((target) => target.serverId === serverId)
            .sort((left, right) => left.sessionId.localeCompare(right.sessionId)
                || left.discussionId.localeCompare(right.discussionId))
        : [];
    const currentIds = () => readHostActivelyViewed()
        ? [...new Set(getVisibleSessionSurfaces()
            .filter((address) => address.serverId === serverId)
            .map((address) => address.sessionId))].sort()
        : [];
    const stop = (target?: SessionHumanPresenceTarget) => {
        if (!typing || (target && targetKey(target) !== targetKey(typing.target))) return;
        clearTimeout(typing.timer);
        if (transport.isConnected() && support === 'supported') transport.send(TYPING_EVENT, {
            v: 1,
            sessionId: typing.target.sessionId,
            ...(typing.target.discussionId ? { discussionId: typing.target.discussionId } : {}),
            typing: false,
        });
        typing = null;
    };
    const publish = () => {
        const ids = currentIds();
        const locations = currentLocations().map(({ sessionId, discussionId }) => ({ sessionId, discussionId }));
        const desiredKeys = new Set(locations.map((location) => `${location.sessionId}\u0000${location.discussionId}`));
        if (typing && (typing.target.discussionId
            ? !desiredKeys.has(`${typing.target.sessionId}\u0000${typing.target.discussionId}`)
            : !ids.includes(typing.target.sessionId))) stop();
        if (disposed || !connected || pending) return;
        const sentLocations = discussionSupport === 'unsupported' ? [] : locations;
        const nextSignature = JSON.stringify([ids, sentLocations]);
        if (signature === nextSignature) return;
        if (support === 'unavailable') {
            // A timed-out/malformed acknowledgement does not reveal whether the Home
            // committed the declaration. Do not probe again, but clear that possible
            // declaration once when this host stops presenting every Session.
            if (ids.length === 0 && locations.length === 0 && unacknowledgedDeclarationMayBeApplied) {
                transport.send(VISIBLE_EVENT, { v: 1, sessionIds: [] });
                unacknowledgedDeclarationMayBeApplied = false;
                signature = nextSignature;
            }
            return;
        }
        signature = nextSignature;
        pending = true;
        unacknowledgedDeclarationMayBeApplied = true;
        const issuedGeneration = generation;
        handle.beginDeclaration(ids, sentLocations);
        const payload = {
            v: 1 as const,
            sessionIds: ids,
            ...(sentLocations.length > 0 ? { locations: sentLocations } : {}),
        };
        void transport.sendWithAck(VISIBLE_EVENT, payload).then((raw) => {
            if (disposed || issuedGeneration !== generation) return;
            const parsed = SessionHumanPresenceVisibleReplaceResultV1Schema.safeParse(raw);
            if (!parsed.success) {
                // A malformed or absent reply is inconclusive transport evidence, not
                // proof about the Home. Stop probing this generation.
                stop();
                support = 'unavailable';
                handle.setStatus('unavailable');
                return;
            }
            unacknowledgedDeclarationMayBeApplied = false;
            if (!parsed.data.ok) {
                stop();
                admitted.clear();
                admittedLocations.clear();
                if (parsed.data.errorCode === 'INVALID_REQUEST' && sentLocations.length > 0) {
                    discussionSupport = 'unsupported';
                    signature = null;
                    return;
                }
                if (parsed.data.errorCode === 'UNSUPPORTED_VERSION') {
                    support = 'unavailable';
                    handle.setStatus('unsupported');
                    return;
                }
                // A strict V1 refusal still proves the operation exists, so temporary
                // unavailability must not permanently silence this Home. The attempted
                // signature is retained so the same rejected set is not retried in a
                // loop; the next actual visibility change declares again.
                support = 'supported';
                handle.setStatus('unavailable');
                return;
            }
            support = 'supported';
            admitted = new Set(parsed.data.admittedSessionIds.filter((sessionId) => ids.includes(sessionId)));
            discussionSupport = sentLocations.length > 0 && parsed.data.admittedLocations === undefined
                ? 'unsupported'
                : 'supported';
            admittedLocations = new Set((parsed.data.admittedLocations ?? [])
                .map((location) => `${location.sessionId}\u0000${location.discussionId}`)
                .filter((key) => desiredKeys.has(key)));
            handle.confirmDeclaration(
                [...admitted],
                locations.filter((location) => admittedLocations.has(`${location.sessionId}\u0000${location.discussionId}`)),
            );
            if (typing && (typing.target.discussionId
                ? !admittedLocations.has(`${typing.target.sessionId}\u0000${typing.target.discussionId}`)
                : !admitted.has(typing.target.sessionId))) stop();
        }).catch(() => {
            if (disposed || issuedGeneration !== generation) return;
            stop();
            support = 'unavailable';
            handle.setStatus('unavailable');
        }).finally(() => {
            if (disposed || issuedGeneration !== generation) return;
            pending = false;
            publish();
        });
    };
    const attachment: Attachment = {
        dispose: (preserveObservation) => dispose(preserveObservation),
        publish,
        stop,
        edit(sessionId, nonEmpty) {
            const target = sessionId;
            if (!nonEmpty) { stop(target); return; }
            const targetAdmitted = target.discussionId
                ? admittedLocations.has(`${target.sessionId}\u0000${target.discussionId}`)
                : admitted.has(target.sessionId);
            const targetVisible = target.discussionId
                ? currentLocations().some((location) => targetKey(location) === targetKey(target))
                : currentIds().includes(target.sessionId);
            if (disposed || !connected || support !== 'supported' || !targetAdmitted || !targetVisible) return;
            if (!typing || targetKey(typing.target) !== targetKey(target)) stop();
            const now = Date.now();
            const renew = !typing || now - typing.renewedAt >= 2_000;
            const renewedAt = renew ? now : typing!.renewedAt;
            if (typing) clearTimeout(typing.timer);
            if (renew) transport.send(TYPING_EVENT, {
                v: 1,
                sessionId: target.sessionId,
                ...(target.discussionId ? { discussionId: target.discussionId } : {}),
                typing: true,
            });
            typing = { target, renewedAt, timer: setTimeout(() => stop(target), 4_000) };
        },
    };
    homes.set(serverId, attachment);
    if (!detachVisibility) {
        const notify = () => { for (const home of homes.values()) home.publish(); };
        const offSurfaces = subscribeSessionSurfaceVisibility(notify);
        const offHost = subscribeToHostActivelyViewed(notify);
        detachVisibility = () => { offSurfaces(); offHost(); };
    }
    const changeStatus = () => {
        const next = transport.isConnected();
        if (next === connected) return;
        stop();
        connected = next;
        generation++;
        pending = false;
        signature = null;
        admitted.clear();
        admittedLocations.clear();
        discussionSupport = 'unknown';
        unacknowledgedDeclarationMayBeApplied = false;
        if (connected) {
            handle = sessionHumanPresenceStore.attachHome(serverId, accountId);
            support = 'unknown';
            publish();
        } else handle.setStatus('connecting');
    };
    const offStatus = transport.subscribeStatus(changeStatus);
    const offSnapshot = transport.subscribeSnapshot((raw) => {
        if (!disposed && connected && support === 'supported') handle.receiveSnapshot(raw);
    });
    changeStatus();
    function dispose(preserveObservation = false) {
        if (disposed) return;
        stop();
        if (connected && (support === 'supported' || unacknowledgedDeclarationMayBeApplied)) {
            transport.send(VISIBLE_EVENT, { v: 1, sessionIds: [] });
            unacknowledgedDeclarationMayBeApplied = false;
        }
        disposed = true;
        generation++;
        offStatus(); offSnapshot();
        if (!preserveObservation) handle.dispose();
        if (homes.get(serverId) === attachment) homes.delete(serverId);
        if (homes.size === 0) { detachVisibility?.(); detachVisibility = null; }
    }
    return dispose;
}
