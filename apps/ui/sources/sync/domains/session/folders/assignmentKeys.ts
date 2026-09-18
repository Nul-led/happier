import { sessionAddressKey } from '../sessionAddress';

export type SessionFolderAddress = Readonly<{ serverId: string; folderId: string }>;

export function sessionFolderAddressKey(address: SessionFolderAddress): string {
    return JSON.stringify([address.serverId.trim(), address.folderId.trim()]);
}

export function buildSessionFolderAssignmentKey(serverId: string | null | undefined, sessionId: string): string {
    const normalizedServerId = typeof serverId === 'string' ? serverId.trim() : '';
    const normalizedSessionId = sessionId.trim();
    return normalizedServerId
        ? sessionAddressKey({ serverId: normalizedServerId, sessionId: normalizedSessionId })
        : JSON.stringify([null, normalizedSessionId]);
}
