import { downloadBulkPayloadViaMachineRpcToDestination } from './downloadBulkPayloadViaMachineRpcToDestination';
import { resolveBulkTransferJsonMaxBytes } from '../plumbing/resolveBulkTransferJsonMaxBytes';

export async function downloadBulkJsonPayloadViaMachineRpc<TPayload>(params: Readonly<{
    init: (request: Readonly<{ recipientPublicKeyBase64: string }>) => Promise<
        | Readonly<{ success: true; downloadId: string; chunkSizeBytes: number; sizeBytes: number; name: string }>
        | Readonly<{ success: false; error: string; errorCode?: string }>
    >;
    readChunk: (request: Readonly<{ downloadId: string; index: number }>) => Promise<
        | Readonly<{
            success: true;
            payloadBase64?: string;
            encryptedDataKeyEnvelopeBase64?: string;
            contentBase64?: string;
            isLast: boolean;
        }>
        | Readonly<{ success: false; error: string; errorCode?: string }>
    >;
    finalize: (request: Readonly<{ downloadId: string }>) => Promise<Readonly<{ success: boolean; error?: string }>>;
    parsePayload: (value: unknown) => TPayload | null;
    abort?: ((request: Readonly<{ downloadId: string }>) => Promise<unknown>) | null;
    onProgress?: ((progress: Readonly<{ downloadedBytes: number; totalBytes: number }>) => void) | null;
    signal?: AbortSignal | null;
}>): Promise<
    | Readonly<{ ok: true; payload: TPayload }>
    | Readonly<{ ok: false; error: string; errorCode?: string }>
> {
    const jsonMaxBytes = resolveBulkTransferJsonMaxBytes(null);
    let receivedBytes = 0;
    let buffer: Uint8Array | null = null;
    let bufferOffset = 0;

    function ensureCapacity(requiredBytes: number): void {
        if (buffer === null) {
            buffer = new Uint8Array(Math.min(jsonMaxBytes, Math.max(1, requiredBytes)));
            bufferOffset = 0;
            return;
        }
        const currentBuffer = buffer;
        if (requiredBytes <= currentBuffer.byteLength) return;
        const nextCapacity = Math.min(
            jsonMaxBytes,
            Math.max(requiredBytes, Math.max(1, currentBuffer.byteLength) * 2),
        );
        if (nextCapacity < requiredBytes) {
            throw new Error(`Downloaded JSON payload exceeds max allowed bytes (${jsonMaxBytes})`);
        }
        const next = new Uint8Array(nextCapacity);
        next.set(currentBuffer.subarray(0, bufferOffset), 0);
        buffer = next;
    }

    const download = await downloadBulkPayloadViaMachineRpcToDestination({
        destination: {
            writeBytes: async (bytes) => {
                const nextTotal = receivedBytes + bytes.byteLength;
                if (nextTotal > jsonMaxBytes) {
                    throw new Error(`Downloaded JSON payload exceeds max allowed bytes (${jsonMaxBytes})`);
                }
                receivedBytes = nextTotal;
                ensureCapacity(bufferOffset + bytes.byteLength);
                if (buffer === null) throw new Error('Downloaded transfer payload returned an unsupported response');
                buffer.set(bytes, bufferOffset);
                bufferOffset += bytes.byteLength;
            },
            close: async () => {},
            cleanup: async () => {
                receivedBytes = 0;
                buffer = null;
                bufferOffset = 0;
            },
        },
        init: async (request) => await params.init(request),
        readChunk: async (request) => await params.readChunk(request),
        finalize: async (request) => await params.finalize(request),
        abort: params.abort ?? null,
        onInit: async (init) => {
            if (init.sizeBytes > jsonMaxBytes) {
                return { success: false as const, error: `Downloaded JSON payload exceeds max allowed bytes (${jsonMaxBytes})` };
            }
            ensureCapacity(init.sizeBytes);
        },
        onProgress: params.onProgress ?? null,
        signal: params.signal ?? null,
    });
    if (!download.ok) return download;

    try {
        if (buffer === null) return { ok: false, error: 'Downloaded transfer payload returned an unsupported response' };
        const parsedPayload = params.parsePayload(JSON.parse(
            new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, receivedBytes)),
        ));
        return parsedPayload === null
            ? { ok: false, error: 'Downloaded transfer payload returned an unsupported response' }
            : { ok: true, payload: parsedPayload };
    } catch {
        return { ok: false, error: 'Downloaded transfer payload is not valid JSON' };
    }
}
