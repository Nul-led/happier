import { ConversationBindingV1Schema, resolveSessionPullRequestLinksV1,
    type ConversationBindingV1, type SessionPullRequestLinksV1 } from '@happier-dev/channels-protocol/v1';
import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import type { PluginAccountAvailabilityReader, PluginAccountAvailabilityCollectionContractAdmission } from '@/sync/domains/plugins/availability/reader';
import { createActivePluginCollectionClientForContractRef,
    type ActivePluginCollectionUnavailableV1, type ActivePluginCollectionRejectedV1 } from './activePluginCollectionClient';

export type SessionPullRequestLinksReadOutcomeV1 =
    | Readonly<{ status: 'ready'; scope: ActiveServerAccountScopeLifetime['scope']; sessions: readonly SessionPullRequestLinksV1[] }>
    | ActivePluginCollectionUnavailableV1
    | ActivePluginCollectionRejectedV1
    | Readonly<{ status: 'unavailable'; reason: Extract<PluginAccountAvailabilityCollectionContractAdmission, { kind: 'unavailable' }>['code'] }>;

/** Account-only projection: Data owns paging/envelopes; Channels owns link semantics. */
export async function readActiveSessionPullRequestLinks(input: Readonly<{
    accountLifetime: ActiveServerAccountScopeLifetime;
    readAvailability: () => PluginAccountAvailabilityReader;
    sessionIds?: readonly string[];
    signal?: AbortSignal;
}>): Promise<SessionPullRequestLinksReadOutcomeV1> {
    if (input.signal?.aborted) return { status: 'unavailable', reason: 'operation-cancelled' };
    if (!input.accountLifetime.isCurrent()) return { status: 'unavailable', reason: 'account-scope-changed' };
    const admission = input.readAvailability().readCurrentCollectionContract({
        pluginId: 'happier.channels', collectionId: 'channel-state',
    });
    if (admission.kind === 'unavailable') return { status: 'unavailable', reason: admission.code };
    const options = input.signal ? { signal: input.signal } : {};
    const resolved = await createActivePluginCollectionClientForContractRef({
        ref: admission.ref, accountLifetime: input.accountLifetime, options,
    });
    if (resolved.status !== 'ready') return resolved;
    const bindings: ConversationBindingV1[] = [];
    let cursor: string | undefined;
    do {
        const page = await resolved.client.query({ indexId: 'by-kind', prefix: ['binding'], order: 'asc',
            ...(cursor === undefined ? {} : { cursor }),
        }, options);
        if (page.status !== 'ready') return page;
        for (const { value } of page.rows) {
            const payload = value.payload;
            if (value['record-kind'] !== 'binding' || value.id !== value['binding-id']
                || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
                return { status: 'unavailable', reason: 'response-invalid' };
            }
            // Channels stores these binding fields structurally, outside its private payload.
            const parsed = ConversationBindingV1Schema.safeParse({ ...payload,
                v: value.v, id: value.id, connectionId: value['connection-id'],
                createdAt: value['created-at'], updatedAt: value['updated-at'],
            });
            if (!parsed.success) return { status: 'unavailable', reason: 'response-invalid' };
            bindings.push(parsed.data);
        }
        cursor = page.nextCursor;
    } while (cursor !== undefined);
    if (input.signal?.aborted) return { status: 'unavailable', reason: 'operation-cancelled' };
    if (!input.accountLifetime.isCurrent()) return { status: 'unavailable', reason: 'account-scope-changed' };
    const sessionIds = input.sessionIds ? new Set(input.sessionIds) : null;
    const sessions = resolveSessionPullRequestLinksV1(bindings)
        .filter((session) => sessionIds === null || sessionIds.has(session.sessionId));
    return { status: 'ready', scope: input.accountLifetime.scope, sessions };
}
