import { useSessionFileTransferAvailability } from './useSessionFileTransferAvailability';

export function useSessionFileUploadAvailability(sessionId: string, sessionServerId?: string | null): boolean {
    return useSessionFileTransferAvailability(sessionId, sessionServerId);
}
