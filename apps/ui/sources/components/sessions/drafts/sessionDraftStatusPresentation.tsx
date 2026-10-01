import type { TranslationKey } from '@/text';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import type { AgentInputStatusBadge } from '@/components/sessions/agentInput/agentInputContracts';
import type { SessionDraftStatus } from '@/sync/ops/sessionDrafts/sessionDraftRepository';

export function resolveSessionDraftStatusKey(status: SessionDraftStatus): TranslationKey | null {
    switch (status) {
        case 'pending': return 'sessionDrafts.status.syncing';
        case 'offline': return 'sessionDrafts.status.offline';
        case 'conflict': return 'sessionDrafts.status.conflict';
        case 'error': return 'common.error';
        case 'unsupported': return 'sessionDrafts.status.unsupported';
        case 'clean': return null;
    }
}

export function buildSessionDraftSyncStatusBadge(status: SessionDraftStatus): AgentInputStatusBadge | null {
    if (status === 'clean' || status === 'pending' || status === 'conflict') return null;
    const statusKey = resolveSessionDraftStatusKey(status);
    if (!statusKey) return null;
    const label = t(statusKey);
    return {
        key: 'draft-sync-status',
        label,
        accessibilityLabel: label,
        testID: 'session-draft-sync-status-badge',
        // A Home that cannot sync this draft is a standing condition, not a
        // failure to retry, so it reads like `offline` rather than an error.
        tone: status === 'offline' || status === 'unsupported' ? 'paused' : 'warning',
        emphasis: status === 'error' ? 'prominent' : 'quiet',
        icon: (tint: string) => (
            <Icon
                name={status === 'offline' || status === 'unsupported' ? 'cloud' : 'warning-circle'}
                size={14}
                color={tint}
            />
        ),
    };
}
