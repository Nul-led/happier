import { BOX_BUNDLE_PUBLIC_KEY_BYTES } from './boxBundleFormat.js';

/**
 * Fixed byte lengths of the released Account content-key binding: the Ed25519
 * Account signing key that makes the claim, the X25519 content key it binds,
 * and the detached signature over them.
 *
 * Wire schemas import these constants without loading signing or encryption
 * implementations into the public SDK browser surface. The signer/verifier
 * consumes the same constants; tests check their agreement with the
 * underlying primitive.
 */
export const ACCOUNT_SIGNING_PUBLIC_KEY_BYTES_V1 = 32;
export const ACCOUNT_SIGNING_SECRET_KEY_BYTES_V1 = 64;
export const ACCOUNT_CONTENT_KEY_BINDING_SIGNATURE_BYTES_V1 = 64;

/** The bound content key is the recipient key of the box bundle, not a second format. */
export const ACCOUNT_CONTENT_PUBLIC_KEY_BYTES_V1 = BOX_BUNDLE_PUBLIC_KEY_BYTES;
