/**
 * Pre-dispatch admission for memory-hard password work.
 *
 * `crypto.scrypt` exposes no abort signal: once a run is handed to libuv the
 * process pays for it in full even if the caller has already gone away. That
 * means load shedding must happen before dispatch. The primitive benchmark
 * measures the work remaining after its caller abandons the result.
 *
 * The two bounds both come from real structure rather than nearby round
 * numbers:
 *
 * - Concurrency follows the configured libuv threadpool width. Additional
 *   submissions would queue in libuv instead of this bounded admission owner.
 * - Queue depth uses a nominal latency budget and reference verification cost.
 *   This bounds retained requests, not elapsed wait: CPU contention and other
 *   libuv work can make verification slower than the reference measurement.
 */

/** libuv's default threadpool size; the deployment may raise it. */
const DEFAULT_LIBUV_THREADPOOL_SIZE = 4;

/**
 * Nominal queue-sizing budget, not a timeout or guaranteed maximum wait.
 * The boundary sheds when the resulting queue depth is full.
 */
export const PASSWORD_HASH_MAX_QUEUE_WAIT_MS = 1_000;

/** Measured single-verification cost of the selected profile on Node 22. */
export const PASSWORD_HASH_MEASURED_LATENCY_MS = 226;

export function resolveLibuvThreadpoolSize(
    env: NodeJS.ProcessEnv = process.env,
): number {
    const configured = Number.parseInt(env.UV_THREADPOOL_SIZE ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_LIBUV_THREADPOOL_SIZE;
}

export type PasswordHashAdmission = Readonly<{
    /**
     * Run `work` under the concurrency bound, or reject with
     * `password_hash_overloaded` when the queue is already at its ceiling. The
     * caller maps that to its own typed load-shedding response; this owner does
     * not know about HTTP.
     */
    run: <T>(work: () => Promise<T>) => Promise<T>;
    readonly maxConcurrent: number;
    readonly maxQueued: number;
    /** Test/diagnostic view; not a metrics contract. */
    inspect: () => Readonly<{ active: number; queued: number }>;
}>;

export class PasswordHashOverloadedError extends Error {
    constructor() {
        super('password_hash_overloaded');
        this.name = 'PasswordHashOverloadedError';
    }
}

export function createPasswordHashAdmission(options: Readonly<{
    maxConcurrent?: number;
    maxQueued?: number;
}> = {}): PasswordHashAdmission {
    const maxConcurrent = options.maxConcurrent ?? resolveLibuvThreadpoolSize();
    const maxQueued = options.maxQueued ?? Math.max(
        1,
        Math.floor((PASSWORD_HASH_MAX_QUEUE_WAIT_MS / PASSWORD_HASH_MEASURED_LATENCY_MS) * maxConcurrent),
    );

    let active = 0;
    const waiting: (() => void)[] = [];

    const release = () => {
        const next = waiting.shift();
        // Transfer the occupied slot directly. Decrementing before the waiter
        // resumes lets a new arrival take the same slot in another microtask.
        if (next) next(); else active -= 1;
    };

    return {
        maxConcurrent,
        maxQueued,
        inspect: () => ({ active, queued: waiting.length }),
        run: async <T>(work: () => Promise<T>): Promise<T> => {
            if (active >= maxConcurrent) {
                if (waiting.length >= maxQueued) throw new PasswordHashOverloadedError();
                await new Promise<void>((resolve) => waiting.push(resolve));
            } else {
                active += 1;
            }
            try {
                return await work();
            } finally {
                release();
            }
        },
    };
}
