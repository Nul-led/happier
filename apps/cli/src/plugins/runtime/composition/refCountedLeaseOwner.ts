export type RefCountedLease<Payload extends object, ReleaseOptions> = Readonly<
    Payload & {
        retain(): RefCountedLease<Payload, ReleaseOptions>;
        release(options?: ReleaseOptions): Promise<void>;
    }
>;

/** Private composition primitive for resources disposed after their final lease. */
export function createRefCountedLeaseOwner<Payload extends object, ReleaseOptions>(input: Readonly<{
    payload: Payload;
    disposedError: string;
    dispose(options?: ReleaseOptions): Promise<void>;
}>): Readonly<{
    retain(): RefCountedLease<Payload, ReleaseOptions>;
}> {
    let references = 0;
    let disposed = false;
    let disposal: Promise<void> | null = null;
    const owner = {
        retain(): RefCountedLease<Payload, ReleaseOptions> {
            if (disposed) throw new Error(input.disposedError);
            references += 1;
            let released = false;
            return Object.freeze({
                ...input.payload,
                retain: () => owner.retain(),
                async release(options?: ReleaseOptions) {
                    if (released) return;
                    released = true;
                    references -= 1;
                    if (references !== 0) return;
                    disposed = true;
                    disposal ??= input.dispose(options);
                    await disposal;
                },
            });
        },
    };
    return Object.freeze(owner);
}
