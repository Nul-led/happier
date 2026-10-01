import type { Message } from "@happier-dev/session-core/messages";
import type { ActivitySequenceEventReferenceV1, AgentRequestKind } from '@happier-dev/protocol';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

type ActivitySessionUpdateNotification = Readonly<{
    address: SessionAddress;
    messages?: Message[];
} & (
    | { event: 'human_message'; committedSequence: ActivitySequenceEventReferenceV1; sourceAccountId: string }
    | { event: 'message'; committedSequence: ActivitySequenceEventReferenceV1 }
    | { event: 'failed' | 'cancelled'; turnId: string }
    | { event: 'source_unavailable' }
)>;

export type ActivityLocalNotificationEvent =
    | (ActivitySessionUpdateNotification & Readonly<{ kind: 'session-update' }>)
    | Readonly<{
        kind: 'ready';
        event: 'ready';
        address: SessionAddress;
        messages?: Message[];
        committedSequence?: ActivitySequenceEventReferenceV1;
        committedLocalId?: string;
    }>
    | Readonly<{
        kind: 'agent-request';
        event: 'permission_required' | 'user_action_required';
        address: SessionAddress;
        requestId: string;
        turnId?: string;
        requestKind: AgentRequestKind;
        toolName: string;
        toolArgs: unknown;
    }>;

type Listener = (event: ActivityLocalNotificationEvent) => void;

const listeners = new Set<Listener>();

function publish(event: ActivityLocalNotificationEvent): void {
    for (const listener of Array.from(listeners)) {
        try {
            listener(event);
        } catch {
            // One consumer cannot prevent the other current consumers from receiving a fact.
        }
    }
}

export function notifyActivitySessionUpdate(params: ActivitySessionUpdateNotification): void {
    const address = normalizeSessionAddress(params.address.serverId, params.address.sessionId);
    if (!address) return;
    publish({ ...params, address, kind: 'session-update' });
}

export function subscribeActivityLocalNotifications(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function notifyActivityReady(
    addressInput: SessionAddress,
    messages?: Message[],
    committedSequence?: ActivitySequenceEventReferenceV1,
    committedLocalId?: string,
): void {
    const address = normalizeSessionAddress(addressInput.serverId, addressInput.sessionId);
    if (!address) return;

    const event: ActivityLocalNotificationEvent = {
        kind: 'ready',
        event: 'ready',
        address,
        messages,
        ...(committedSequence ? { committedSequence } : {}),
        ...(committedLocalId ? { committedLocalId } : {}),
    };

    publish(event);
}

export function notifyActivityAgentRequest(params: Readonly<{
    address: SessionAddress;
    requestId: string;
    turnId?: string;
    requestKind: AgentRequestKind;
    toolName: string;
    toolArgs: unknown;
}>): void {
    const address = normalizeSessionAddress(params.address.serverId, params.address.sessionId);
    const requestId = typeof params.requestId === 'string' ? params.requestId.trim() : '';
    const toolName = typeof params.toolName === 'string' ? params.toolName.trim() : '';
    if (!address || !requestId || !toolName) return;

    const event: ActivityLocalNotificationEvent = {
        kind: 'agent-request',
        event: params.requestKind === 'permission' ? 'permission_required' : 'user_action_required',
        address,
        requestId,
        ...(typeof params.turnId === 'string' && params.turnId.trim().length > 0
            ? { turnId: params.turnId.trim() }
            : {}),
        requestKind: params.requestKind,
        toolName,
        toolArgs: params.toolArgs,
    };

    publish(event);
}

export function resetActivityLocalNotificationRuntimeForTests(): void {
    listeners.clear();
}
