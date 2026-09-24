import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

/**
 * Lane 05's one UI admission for the Conversations body.
 *
 * Collaboration placement stays Lane 04-owned, but neither that host nor a
 * direct Conversations consumer should reinterpret the dependent feature
 * decision: the catalog makes `sessions.conversations` depend on
 * `sharing.session`, so this one decision already fails closed without it.
 */
export function useSessionConversationsAvailability(serverId: string): boolean {
    return useFeatureEnabled('sessions.conversations', { scopeKind: 'spawn', serverId });
}
