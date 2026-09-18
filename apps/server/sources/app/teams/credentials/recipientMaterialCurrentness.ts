import type { AccountEncryptionCurrentness } from "@/app/encryption/accountContentKeyAdmission";

type StoredRecipientBinding = Readonly<{
    // Prisma persists this wire discriminator as a string. Invalid historical
    // or corrupt values must fail the currentness comparison closed.
    recipientMode: string;
    recipientContentPublicKeyFingerprint: string | null;
}>;

/**
 * Compares a prepared direct-material row with the canonical current Account
 * encryption binding. Both recipient-facing catalog projection and the
 * source-owner census use this single decision.
 */
export function matchesTeamCredentialRecipientBinding(
    stored: StoredRecipientBinding,
    current: AccountEncryptionCurrentness,
): boolean {
    return stored.recipientMode === current.encryptionMode
        && stored.recipientContentPublicKeyFingerprint
            === current.contentPublicKeyFingerprint;
}
