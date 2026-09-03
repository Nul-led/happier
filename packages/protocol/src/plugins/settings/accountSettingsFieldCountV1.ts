/**
 * Canonical Account Settings field cardinality.
 *
 * It is declared here rather than inside `PLUGIN_ACCOUNT_SETTINGS_LIMITS_V1`
 * because that object also derives a ciphertext bound from the Account cipher
 * envelope. Schema owners that need only this plaintext cardinality — the
 * Settings administration Action result and the daemon contribution-registry
 * projection — are reachable from browser-realm SDK leaves, and those leaves
 * must not transitively reach the Account cipher domain.
 */
export const PLUGIN_ACCOUNT_SETTINGS_MAXIMUM_FIELDS_V1 = 256;
