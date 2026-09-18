/**
 * Filter options for Activity attention presentation.
 *
 * Direct-session personal attention is owned by
 * `resolveSessionPersonalAttentionForViewer` (Protocol
 * `resolveSessionPersonalAttentionV1`); external Background-sync unread is
 * owned by `deriveExternalSessionAttentionHasUnread`. This module must remain
 * a type-only filter-options owner and must not decide current attention from
 * a hydrated row, shared cursor, or local runtime derivation.
 */
export type SessionAttentionOptions = Readonly<{
    showUnread?: boolean;
    showPendingPermissionRequests?: boolean;
    showPendingUserActionRequests?: boolean;
    showQueuedUserInput?: boolean;
}>;
