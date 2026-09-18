import { useSessionFileTransferAvailability } from './useSessionFileTransferAvailability';

export function useSessionFileDownloadAvailability(sessionId: string, sessionServerId?: string | null): boolean {
    return useSessionFileTransferAvailability(sessionId, sessionServerId);
}
