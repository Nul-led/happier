import { useSessionFileTransferAvailability } from './useSessionFileTransferAvailability';
import { sync } from '@/sync/sync';

export function useSessionFileUploadAvailability(
    sessionId: string,
    sessionServerId?: string | null,
    purpose: 'workspaceFile' | 'attachment' = 'workspaceFile',
): boolean {
    // Only attachment transfers can use the Session-bound carrier. Arbitrary
    // workspace file transfers retain their existing machine authority.
    const sessionBound = purpose === 'attachment' ? sync.getSessionAttachmentTransferContext(sessionId) : undefined;
    const machineAvailable = useSessionFileTransferAvailability(sessionId, sessionServerId, !sessionBound);
    return Boolean(sessionBound) || machineAvailable;
}
