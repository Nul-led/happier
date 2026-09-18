import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';

/**
 * Lane 05's one UI admission for the Conversations body.
 *
 * Collaboration placement stays Lane 04-owned, but neither that host nor a
 * direct Conversations consumer should reinterpret the dependent feature
 * decision. Missing or partial server support therefore fails closed here.
 */
export function useSessionConversationsAvailability(serverId: string): boolean {
    const collaborationAvailability = useSessionCollaborationAvailability(serverId);
    const featureEnabled = useFeatureEnabled('sessions.conversations', {
        scopeKind: 'spawn',
        serverId,
    });
    return featureEnabled && collaborationAvailability === 'full_collaboration';
}
