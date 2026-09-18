import { BOX_BUNDLE_MIN_BYTES } from './boxBundleFormat.js';

/**
 * Wire layout of the versioned fixed data-key envelope: one version byte
 * followed by a box bundle around exactly one 32-byte data key.
 *
 * Wire schemas import these constants without loading the seal/open codec's
 * Node-reachable dependency graph into the public SDK browser surface. The
 * codec consumes and re-exports the same constants.
 */
export const ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE = 0;
export const ENCRYPTED_DATA_KEY_V1_BYTES = 32;
export const ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES =
  1 + BOX_BUNDLE_MIN_BYTES + ENCRYPTED_DATA_KEY_V1_BYTES;

/** Canonical padded Base64 length of one envelope; no envelope is any other size. */
export const ENCRYPTED_DATA_KEY_ENVELOPE_V1_BASE64_LENGTH =
  4 * Math.ceil(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES / 3);
