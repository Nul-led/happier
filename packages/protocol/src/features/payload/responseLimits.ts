/**
 * Maximum encoded `/v1/features` response accepted before JSON parsing.
 * The response is a bounded capability document, and clients enforce this
 * receive-memory boundary while streaming rather than trusting Content-Length.
 */
export const FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 = 1024 * 1024;
