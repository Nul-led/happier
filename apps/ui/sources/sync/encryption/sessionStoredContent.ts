import { StrictSessionStoredMessageContentEnvelopeSchema, type StrictJsonValue, type StrictSessionStoredMessageContentEnvelope } from '@happier-dev/protocol';

export type SessionContentEncryption = Readonly<{
    encryptRaw(payload: unknown): Promise<string>;
    decryptRaw(ciphertext: string): Promise<unknown | null>;
    /** Available on the canonical Session cipher used by mutation hosts. */
    deriveDiscussionMutationEqualityTagV1?(canonicalIntent: string): string;
}>;
export type SessionStoredContentContext =
    | Readonly<{ mode: 'plain' }>
    | Readonly<{ mode: 'e2ee'; encryption: SessionContentEncryption | null }>;
export type OpenSessionStoredContentResult =
    | Readonly<{ status: 'ready'; value: unknown }>
    | Readonly<{ status: 'locked' | 'mode_mismatch' | 'corrupt_or_unopenable' | 'malformed' }>;

export async function openSessionStoredContent(context: SessionStoredContentContext | null, input: unknown): Promise<OpenSessionStoredContentResult> {
    const parsed = StrictSessionStoredMessageContentEnvelopeSchema.safeParse(input);
    if (!parsed.success) return { status: 'malformed' };
    if (!context) return { status: 'locked' };
    const content = parsed.data;
    if (context.mode === 'plain') return content.t === 'plain' ? { status: 'ready', value: content.v } : { status: 'mode_mismatch' };
    if (content.t !== 'encrypted') return { status: 'mode_mismatch' };
    if (!context.encryption) return { status: 'locked' };
    try {
        const value = await context.encryption.decryptRaw(content.c);
        return value === null || value === undefined ? { status: 'corrupt_or_unopenable' } : { status: 'ready', value };
    } catch {
        return { status: 'corrupt_or_unopenable' };
    }
}

export async function sealSessionStoredContent(context: SessionStoredContentContext | null, payload: StrictJsonValue): Promise<
    Readonly<{ status: 'ready'; content: StrictSessionStoredMessageContentEnvelope }> | Readonly<{ status: 'locked' }>
> {
    if (!context) return { status: 'locked' };
    if (context.mode === 'plain') return { status: 'ready', content: { t: 'plain', v: payload } };
    if (!context.encryption) return { status: 'locked' };
    return { status: 'ready', content: { t: 'encrypted', c: await context.encryption.encryptRaw(payload) } };
}
