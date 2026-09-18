import type { Message } from '@/sync/domains/messages/messageTypes';
import type { ActivitySequenceEventReferenceV1, AgentRequestKind } from '@happier-dev/protocol';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

export type ActivityLocalNotificationEvent =
    | Readonly<{
        kind: 'ready';
        event: 'ready';
        address: SessionAddress;
        messages?: Message[];
        committedSequence?: ActivitySequenceEventReferenceV1;
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
): void {
    const address = normalizeSessionAddress(addressInput.serverId, addressInput.sessionId);
    if (!address) return;

    const event: ActivityLocalNotificationEvent = {
        kind: 'ready',
        event: 'ready',
        address,
        messages,
        ...(committedSequence ? { committedSequence } : {}),
    };

    for (const listener of Array.from(listeners)) {
        try {
            listener(event);
        } catch {
            // ignore listener failures
        }
    }
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

    for (const listener of Array.from(listeners)) {
        try {
            listener(event);
        } catch {
            // ignore listener failures
        }
    }
}

export function resetActivityLocalNotificationRuntimeForTests(): void {
    listeners.clear();
}
