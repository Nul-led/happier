/**
 * Wire layout of the generic NaCl box bundle: `ephemeralPublicKey || nonce ||
 * boxed`. The bundle reader owns this allocation independently of the box
 * implementation so structural admission and encoded-size math stay
 * browser-safe, the same split `accountScopedCipherEnvelope.ts` makes for the
 * Account secretbox.
 *
 * These are released sizes every runtime (JS, Swift, Android C++) reproduces,
 * not an implementation choice. `boxBundle.ts` re-exports them and its test
 * pins each one to the primitive it frames, so they cannot drift from the
 * codec that produces the bytes.
 */
export const BOX_BUNDLE_PUBLIC_KEY_BYTES = 32;
export const BOX_BUNDLE_NONCE_BYTES = 24;
export const BOX_BUNDLE_TAG_BYTES = 16;
export const BOX_BUNDLE_MIN_BYTES =
  BOX_BUNDLE_PUBLIC_KEY_BYTES + BOX_BUNDLE_NONCE_BYTES + BOX_BUNDLE_TAG_BYTES;
