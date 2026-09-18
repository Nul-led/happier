import type { SessionDataKeyEnvelopeItemV1, SessionDataKeyEnvelopeSummaryV1 } from '@happier-dev/protocol';

import { t } from '@/text';

import type {
    SessionAccessEncryptionPreparation,
    SessionAccessEncryptionRecipientsState,
} from './sessionAccessEditorState';
import type {
    SessionAccessEncryptionModel,
    SessionAccessEncryptionRecipientRowModel,
    SessionAccessEncryptionRecipientState,
    SessionAccessUiReason,
} from './sessionAccessEditorTypes';

/**
 * The one Session-scoped `Encrypted access` aggregate the access editor renders.
 *
 * Every settled count comes from the recipient-key owner's own server summary for
 * the whole Session. Nothing here is recomputed from grant rows: a Team grant is
 * one row and many recipients, so a locally derived count would be a different,
 * quieter lie than showing the server's.
 *
 * A healthy audience stays quiet — one ready line, no badge on every person. The
 * exceptions discovery already fetched are listed beneath the aggregate by default,
 * so the person who needs setup or repair is named without a second request, and
 * the explicit `Show all people` view stays reachable because a manager who wants
 * to inspect delivery must not have to break something first.
 */

function summarySegments(summary: SessionDataKeyEnvelopeSummaryV1): string {
    const needsAttention = summary.invalid + summary.recipientKeyUnavailable;
    return [
        summary.prepared > 0 ? t('session.access.aggregatePrepared', { count: summary.prepared }) : undefined,
        summary.pending > 0 ? t('session.access.aggregatePending', { count: summary.pending }) : undefined,
        needsAttention > 0 ? t('session.access.aggregateNeedsAttention', { count: needsAttention }) : undefined,
    ].filter((segment): segment is string => segment !== undefined).join(' · ');
}

function recipientState(item: SessionDataKeyEnvelopeItemV1): SessionAccessEncryptionRecipientState {
    // Readiness outranks stored bytes, exactly as the server's own buckets do: an
    // inert tuple left behind on a Plain or inconsistent Account is not delivery.
    if (item.contentKey.status === 'unavailable') return item.contentKey.reason;
    return item.envelopeState === 'prepared' ? 'prepared' : item.envelopeState === 'invalid' ? 'invalid' : 'pending';
}

function recipientStateLabel(state: SessionAccessEncryptionRecipientState): string {
    switch (state) {
        case 'prepared': return t('session.access.ready');
        case 'pending': return t('session.access.pending');
        case 'invalid': return t('session.access.repair');
        case 'plain_account': return t('session.access.recipientPlainAccount');
        case 'encryption_setup_required': return t('session.access.setup');
        case 'encryption_inconsistent': return t('session.access.repair');
    }
}

/**
 * @param displayNameForAccount Lane 04's existing projection, keyed by Account ID.
 *   The encryption resource deliberately carries no names, so an Account outside
 *   the visible grant rows — a Team member, typically — keeps its identifier
 *   rather than acquiring a fabricated one.
 */
export function projectSessionAccessEncryptionRecipientRow(
    item: SessionDataKeyEnvelopeItemV1,
    displayNameForAccount: (accountId: string) => string | undefined,
): SessionAccessEncryptionRecipientRowModel {
    const state = recipientState(item);
    const stateLabel = recipientStateLabel(state);
    const label = displayNameForAccount(item.recipientAccountId) ?? item.recipientAccountId;
    return {
        recipientAccountId: item.recipientAccountId,
        state,
        label,
        stateLabel,
        accessibilityLabel: t('session.access.accessibleSummary', { title: label, label: stateLabel }),
    };
}

export function projectSessionAccessEncryptionSection(input: Readonly<{
    preparation: SessionAccessEncryptionPreparation;
    recipients: SessionAccessEncryptionRecipientsState;
    displayNameForAccount: (accountId: string) => string | undefined;
}>): SessionAccessEncryptionModel | undefined {
    const { preparation, recipients } = input;
    // The all-people view always lists (an empty audience is itself an answer). The
    // default exceptions view lists only when there is an exception or a failed
    // re-read to name, so a healthy audience stays one quiet line.
    const listed = recipients.view === 'all' || recipients.rows.length > 0 || recipients.error !== null;
    const expansion = {
        recipientsView: recipients.view,
        ...(listed ? { recipients: {
            rows: recipients.rows.map((item) => projectSessionAccessEncryptionRecipientRow(item, input.displayNameForAccount)),
            hasMore: recipients.nextCursor !== null,
            loading: recipients.loading,
            ...(recipients.error ? { error: recipients.error } : {}),
        } } : {}),
    };
    const showAllLabel = recipients.view === 'all'
        ? t('session.access.hideAllRecipients')
        : t('session.access.showAllRecipients');

    switch (preparation.kind) {
        case 'idle':
            return undefined;
        case 'preparing': {
            // Determinate only from committed pages against the Home's own actionable
            // total; a locally sealed key is not progress and the visible grants are
            // not a denominator.
            const progressLabel = preparation.actionableTotal !== null && preparation.actionableTotal > 0
                ? t('session.access.preparingProgressOf', {
                    count: preparation.preparedCount, total: preparation.actionableTotal,
                })
                : preparation.preparedCount > 0
                    ? t('session.access.preparingProgress', { count: preparation.preparedCount })
                    : t('session.access.preparing');
            return {
                summaryLabel: t('session.access.preparing'),
                accessibilityLabel: progressLabel,
                progressLabel,
                showAllLabel,
                ...expansion,
            };
        }
        case 'failed':
            return {
                summaryLabel: t('session.access.preparationFailed'),
                accessibilityLabel: t('session.access.preparationFailed'),
                actionLabel: t('session.access.retryAction'),
                error: preparation.error,
                showAllLabel,
                ...expansion,
            };
        case 'settled': {
            // A plain Session needs no envelope, and a scope change proves nothing
            // about the Session now on screen.
            if (preparation.status === 'not_required' || preparation.status === 'scope_changed') return undefined;
            const summary = preparation.summary;
            if (preparation.status === 'session_data_key_unavailable') {
                const reason: SessionAccessUiReason = {
                    code: 'session_access_encryption_key_unavailable',
                    message: t('session.access.preparationKeyUnavailable'),
                };
                return {
                    summaryLabel: reason.message,
                    accessibilityLabel: reason.message,
                    reason,
                    showAllLabel,
                    ...expansion,
                };
            }
            if (!summary) return undefined;
            const actionable = summary.pending + summary.invalid + summary.recipientKeyUnavailable;
            if (actionable === 0) {
                return {
                    summaryLabel: t('session.access.ready'),
                    accessibilityLabel: t('session.access.ready'),
                    showAllLabel,
                    ...expansion,
                };
            }
            const summaryLabel = summarySegments(summary);
            return {
                summaryLabel,
                accessibilityLabel: t('session.access.accessibleSummary', {
                    title: t('session.access.encryptedAccess'), label: summaryLabel,
                }),
                // Replacing structurally invalid bytes is the same operation as first
                // delivery, so it is named for what the manager is repeating.
                actionLabel: summary.invalid > 0
                    ? t('session.access.prepareAgain')
                    : t('session.access.prepareNow'),
                showAllLabel,
                ...expansion,
            };
        }
    }
}
