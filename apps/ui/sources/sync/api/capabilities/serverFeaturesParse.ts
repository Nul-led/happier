import {
    FEATURES_RESPONSE_MAX_UTF8_BYTES_V1,
    FeaturesResponseSchema,
    type FeaturesResponse as ServerFeatures,
} from '@happier-dev/protocol';

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
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
        const bytes = Number(declaredLength);
        if (!Number.isSafeInteger(bytes) || bytes > SERVER_FEATURES_RESPONSE_MAX_UTF8_BYTES) {
            await response.body?.cancel().catch(() => undefined);
            return null;
        }
    }

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            totalBytes += next.value.byteLength;
            if (totalBytes > SERVER_FEATURES_RESPONSE_MAX_UTF8_BYTES) {
                await reader.cancel().catch(() => undefined);
                return null;
            }
            chunks.push(next.value);
        }
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }

    const encoded = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        encoded.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return parseServerFeatures(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded)));
    } catch {
        return null;
    }
}
