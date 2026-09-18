import type { PendingMessage } from '@/sync/domains/state/storageTypes';

/** Main is omission; rows never inherit the currently selected Run. */
export function isPendingMessageForRecipient(
    message: Pick<PendingMessage, 'recipient'>,
    recipient: PendingMessage['recipient'],
): boolean {
    return message.recipient?.runId === recipient?.runId;
}
