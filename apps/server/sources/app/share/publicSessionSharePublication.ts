/**
 * An existing public link remains a publication until it expires or is deleted.
 * A use limit governs new viewer admission, not already-issued message tokens.
 * Keep this lifetime rule shared by public reads and Session-context admission.
 */
export function isPublicSessionShareActive(
    publication: Readonly<{ expiresAt: Date | null }> | null,
    now: Date = new Date(),
): boolean {
    return publication !== null && !(publication.expiresAt && publication.expiresAt <= now);
}
