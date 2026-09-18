import {
    FEATURES_RESPONSE_MAX_UTF8_BYTES_V1,
    FeaturesResponseSchema,
    type FeaturesResponse as ServerFeatures,
} from '@happier-dev/protocol';

import { decodeBoundedJsonResponse } from './decodeBoundedJsonResponse';

export const SERVER_FEATURES_RESPONSE_MAX_UTF8_BYTES = FEATURES_RESPONSE_MAX_UTF8_BYTES_V1;

export function parseServerFeatures(raw: unknown): ServerFeatures | null {
    const parsed = FeaturesResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/**
 * The single public/authenticated feature-response decoder. It charges bytes
 * before UTF-8 decoding or JSON parsing and does not trust Content-Length.
 */
export async function decodeServerFeaturesResponse(response: Response): Promise<ServerFeatures | null> {
    const raw = await decodeBoundedJsonResponse(response, SERVER_FEATURES_RESPONSE_MAX_UTF8_BYTES);
    return raw === null ? null : parseServerFeatures(raw);
}
