import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export type SessionActionDraftStatus = 'editing' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type SessionActionDraft = Readonly<{
    id: string;
    address: SessionAddress;
    /** Account-local persistence partition; never used as Session routing identity. */
    accountId: string;
    actionId: string;
    createdAt: number;
    status: SessionActionDraftStatus;
    input: Record<string, unknown>;
    error?: string | null;
}>;
