import {
    HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD,
    HostPrivatePluginInstallDecisionV1Schema,
} from '@happier-dev/protocol/marketplace/internal';

/**
 * @template T
 * @param {{
 *   pendingChangeId: string;
 *   isAuthorityCurrent: () => boolean | Promise<boolean>;
 *   callAuthenticatedPrivateRpc: (method: typeof HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD, payload: import('@happier-dev/protocol/marketplace/internal').HostPrivatePluginInstallDecisionV1) => Promise<T>;
 * }} params
 * @param {Record<string, unknown> | null} affirmative
 *   The affirmative decision body, or `null` when the present user declined and
 *   the pending change is cancelled instead.
 * @returns {Promise<T>}
 */
async function sendPresentUserDecision(params, affirmative) {
    if (!await params.isAuthorityCurrent()) {
        throw new Error('Authenticated plugin install authority changed during present-user confirmation');
    }

    const payload = HostPrivatePluginInstallDecisionV1Schema.parse(affirmative !== null
        ? affirmative
        : {
            v: 1,
            pendingChangeId: params.pendingChangeId,
            decision: 'cancel',
        });

    return await params.callAuthenticatedPrivateRpc(
        HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD,
        payload,
    );
}

/**
 * Canonical present-user boundary for affirmative private install decisions.
 *
 * UI confirmation and authenticated transport stay injected so composed tests can exercise
 * this exact boundary without exposing a public decision command. The decision names the
 * daemon-issued pending change and nothing about its own author: the authenticated RPC is
 * what establishes the present user, and the daemon stamps approval time from its own clock.
 *
 * @template T
 * @param {{
 *   pendingChangeId: string;
 *   confirmPresentUser: () => Promise<ReadonlyArray<{ accessId: string; selected: boolean }> | null>;
 *   isAuthorityCurrent: () => boolean | Promise<boolean>;
 *   callAuthenticatedPrivateRpc: (method: typeof HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD, payload: import('@happier-dev/protocol/marketplace/internal').HostPrivatePluginInstallDecisionV1) => Promise<T>;
 * }} params
 * @returns {Promise<T>}
 */
export async function decideMachinePluginInstallReviewAsPresentUser(params) {
    const optionalSelections = await params.confirmPresentUser();
    return await sendPresentUserDecision(params, optionalSelections !== null
        ? {
            v: 1,
            pendingChangeId: params.pendingChangeId,
            decision: 'installAndTrust',
            optionalSelections,
        }
        : null);
}
