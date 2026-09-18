/**
 * Reads one bounded JSON metadata response without trusting Content-Length.
 * Byte charging happens before UTF-8 decoding and JSON parsing.
 */
export async function decodeBoundedJsonResponse(
    response: Response,
    maxUtf8Bytes: number,
): Promise<unknown | null> {
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
        const bytes = Number(declaredLength);
        if (!Number.isSafeInteger(bytes) || bytes > maxUtf8Bytes) {
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
            if (totalBytes > maxUtf8Bytes) {
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
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded));
    } catch {
        return null;
    }
}
