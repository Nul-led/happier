import { resolveAgentIdForPermissionUi } from '@/agents/catalog/resolve';
import { resolveServerCredentialAccountScope } from '@/sync/domains/scope/serverCredentialAccountScope';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { resolveSessionPermissionBehavior } from '@/sync/ops/sessionPermissionAnswers';
import { sessionAbort, sessionAllowWithAnswers, sessionRespondToPermission } from '@/sync/ops/sessions';
import { sync } from '@/sync/sync';

import type { SessionTranscriptActions } from './types';

/** The app's Session actions, shared by transcript, Companion and linked plugin approvals. */
export function createAppSessionTranscriptActions(sessionId: string, serverId: string | null): SessionTranscriptActions {
    const rpcOptions = serverId ? { serverId } : undefined;
    return Object.freeze({
        respondToPermission: async (params) => {
            await sessionRespondToPermission(sessionId, params, rpcOptions);
            if (serverId && !areServerProfileIdentifiersEquivalent(serverId, getActiveServerSnapshot().serverId)) return;
            if (params.approved && params.mode === 'acceptEdits') storage.getState().updateSessionPermissionMode(sessionId, 'acceptEdits');
            if (params.decision === 'abort') {
                const session = storage.getState().sessions[sessionId];
                const metadata = session ? readSessionOwnerMetadataView(session) : null;
                const resolution = serverId ? await resolveServerCredentialAccountScope(serverId) : null;
                const behavior = resolveSessionPermissionBehavior({
                    agentId: resolveAgentIdForPermissionUi({ metadata, flavor: metadata?.flavor, toolName: '' }), metadata,
                    accountScope: resolution?.kind === 'bound' ? resolution.scope : serverId ? null : undefined,
                });
                if (behavior?.footer?.forceReadOnlyAfterStop) storage.getState().updateSessionPermissionMode(sessionId, 'read-only');
            }
        },
        answerUserAction: (params) => sessionAllowWithAnswers(sessionId, params.id, params.answers, rpcOptions),
        abort: () => sessionAbort(sessionId, rpcOptions),
        submitMessage: (text, options) => sync.submitMessage(sessionId, text, undefined, undefined, { ...options, ...(serverId ? { serverId } : {}) }),
    } satisfies SessionTranscriptActions);
}
