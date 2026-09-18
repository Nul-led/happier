import { resolveBulkTransferJsonMaxBytes } from './resolveBulkTransferJsonMaxBytes';

function wouldJsonStringifyExceedMaxBytes(value: unknown, maxBytes: number): boolean {
    // Conservative upper-bound estimator to avoid unbounded `JSON.stringify(...)` memory spikes.
    // This intentionally over-estimates (may reject payloads that would fit) but must never under-estimate
    // in a way that allows huge payloads to be stringified before we apply the hard cap.
    let remaining = Math.max(0, Math.floor(maxBytes));
    const seen = new WeakSet<object>();

    function take(bytes: number): boolean {
        remaining -= bytes;
        return remaining < 0;
    }

    function estimateStringBytesUpperBound(text: string): boolean {
        // Worst-case: every UTF-16 code unit becomes a `\\uXXXX` escape (6 ASCII bytes) plus quotes.
        return take(2 + (6 * text.length));
    }

    function estimateValue(v: unknown, context: 'top' | 'array' | 'object'): boolean {
        if (v === null) return take(4);

        if (typeof v === 'string') return estimateStringBytesUpperBound(v);
        if (typeof v === 'number') return take(32);
        if (typeof v === 'boolean') return take(v ? 4 : 5);
        if (typeof v === 'bigint') {
            // JSON.stringify throws; treat as exceeding to fail closed before stringify.
            return true;
        }
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
            // JSON.stringify(undefined) => undefined at top-level, omitted in objects, null in arrays.
            if (context === 'array') return take(4);
            return false;
        }

        if (typeof v !== 'object') return true;

        // `JSON.stringify` calls `toJSON` when present. We must treat this as the value to serialize
        // to avoid under-estimating exotic objects (e.g. Date).
        const candidate = v as { toJSON?: () => unknown };
        if (typeof candidate.toJSON === 'function') {
            try {
                return estimateValue(candidate.toJSON(), context);
            } catch {
                // If `toJSON` is hostile, fail closed and let the caller see the size rejection.
                return true;
            }
        }

        if (Array.isArray(v)) {
            if (take(1)) return true; // '['
            for (let i = 0; i < v.length; i += 1) {
                if (i > 0 && take(1)) return true; // ','
                if (estimateValue(v[i], 'array')) return true;
            }
            return take(1); // ']'
        }

        if (seen.has(v as object)) {
            // Circular values throw in JSON.stringify; fail closed before stringify.
            return true;
        }
        seen.add(v as object);

        if (take(1)) return true; // '{'
        const keys = Object.keys(v as Record<string, unknown>);
        let wroteAny = false;
        for (const key of keys) {
            // Accessing the value may trigger getters; JSON.stringify does too.
            const propValue = (v as Record<string, unknown>)[key];
            const propType = typeof propValue;
            if (propValue === undefined || propType === 'function' || propType === 'symbol') {
                continue;
            }

            if (wroteAny && take(1)) return true; // ','
            wroteAny = true;
            if (estimateStringBytesUpperBound(key)) return true; // key
            if (take(1)) return true; // ':'
            if (estimateValue(propValue, 'object')) return true;
        }

        return take(1); // '}'
    }

    return estimateValue(value, 'top');
}

export function prepareBulkJsonPayloadForUpload(payload: unknown): Readonly<
    | { ok: true; encodedPayload: Uint8Array }
    | { ok: false; error: string }
> {
    const jsonMaxBytes = resolveBulkTransferJsonMaxBytes(null);
    if (wouldJsonStringifyExceedMaxBytes(payload, jsonMaxBytes)) {
        return {
            ok: false,
            error: `Uploaded JSON payload exceeds max allowed bytes (${jsonMaxBytes})`,
        };
    }

    const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));
    if (encodedPayload.byteLength > jsonMaxBytes) {
        return {
            ok: false,
            error: `Uploaded JSON payload exceeds max allowed bytes (${jsonMaxBytes})`,
        };
    }

    return {
        ok: true,
        encodedPayload,
    };
}
