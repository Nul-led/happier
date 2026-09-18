import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export type VoiceSurfaceVariant = 'sidebar' | 'session';

export type VoiceSurfaceProps = Readonly<{
    variant: VoiceSurfaceVariant;
    sessionId?: string | null;
    /** Exact Home for an in-session surface; never reconstructed from ambient focus. */
    serverId?: string | null;
    /** Canonical immutable target supplied by a mounted Session owner. */
    sessionAddress?: SessionAddress | null;
    /**
     * The Session presentation owner's existing fact when it retains a hidden
     * native surface. Other hosts mount only presented surfaces, so absence is
     * deliberately mount-as-presented rather than a second visibility owner.
     */
    isPresented?: boolean;
    style?: unknown;
}>;
