/**
 * Checked-in loaded-QA fault-injection seam for the Personal Home bootstrap runtime-mutation
 * boundary.
 *
 * Lane 03's destructive-arbitration gate requires proving that an explicit uninstall/erase wins
 * *between* two real durable bootstrap mutations. That interleaving cannot be observed from
 * outside the app, so the canonical composition boundary
 * (`usePersonalHomeBootstrapRuntime` → `runRelayTask`) consults this latch before each durable
 * mutation. It is inert unless a QA driver arms it, it only recognises durable relay-runtime
 * mutation kinds, and every hold is bounded by an expiry so a shipped runtime can never stall on
 * it. It owns no bootstrap phase, decision, or recovery state: the canonical controller and the
 * incumbent operation-admission owner keep deciding what happens after the mutation resumes.
 */

const PAUSABLE_MUTATION_KINDS: ReadonlySet<string> = new Set([
    'relay.runtime.installOrUpdate.v1',
    'relay.runtime.start.v1',
    'relay.runtime.restart.v1',
]);

const DEFAULT_PAUSE_TTL_MS = 120_000;
const MAX_PAUSE_TTL_MS = 300_000;

type ArmedPause = { kind: string; ordinal: number; expiresAtMs: number };
type HeldPause = { kind: string; ordinal: number; release: () => void };

let armedPause: ArmedPause | null = null;
let heldPause: HeldPause | null = null;
let observedMutations = 0;

export type PersonalHomeBootstrapQaPauseResult = Readonly<{
    ok: boolean;
    reason?: string;
    armed: Readonly<{ kind: string; ordinal: number; expiresAtMs: number }> | null;
    held: Readonly<{ kind: string; ordinal: number }> | null;
    /** Durable mutations of the armed kind observed since the current arm request. */
    observedMutations: number;
}>;

export type PersonalHomeBootstrapQaPauseRequest = Readonly<{
    action: 'arm' | 'read' | 'release';
    kind?: string;
    ordinal?: number;
    ttlMs?: number;
}>;

function snapshot(ok: boolean, reason?: string): PersonalHomeBootstrapQaPauseResult {
    return {
        ok,
        ...(reason ? { reason } : {}),
        armed: armedPause ? { ...armedPause } : null,
        held: heldPause ? { kind: heldPause.kind, ordinal: heldPause.ordinal } : null,
        observedMutations,
    };
}

function clearPause(): void {
    const release = heldPause?.release;
    armedPause = null;
    heldPause = null;
    observedMutations = 0;
    release?.();
}

/** QA driver entry point. Exposed to the checked-in desktop MCP bridge; never called by product UI. */
export function controlPersonalHomeBootstrapQaMutationPause(
    request: PersonalHomeBootstrapQaPauseRequest,
): PersonalHomeBootstrapQaPauseResult {
    if (request.action === 'read') return snapshot(true);
    if (request.action === 'release') {
        clearPause();
        return snapshot(true);
    }
    const kind = String(request.kind ?? '').trim();
    if (!PAUSABLE_MUTATION_KINDS.has(kind)) return snapshot(false, 'unsupported-mutation-kind');
    const ordinal = Number(request.ordinal);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) return snapshot(false, 'invalid-ordinal');
    const requestedTtl = Number(request.ttlMs);
    const ttlMs = Number.isFinite(requestedTtl) && requestedTtl > 0
        ? Math.min(requestedTtl, MAX_PAUSE_TTL_MS)
        : DEFAULT_PAUSE_TTL_MS;
    clearPause();
    armedPause = { kind, ordinal, expiresAtMs: Date.now() + ttlMs };
    return snapshot(true);
}

/**
 * Production boundary call. Resolves immediately unless a QA driver armed this exact durable
 * mutation ordinal; the hold always ends on release or expiry.
 */
export async function awaitPersonalHomeBootstrapQaMutationPause(kind: string): Promise<void> {
    const armed = armedPause;
    if (!armed || !PAUSABLE_MUTATION_KINDS.has(kind) || kind !== armed.kind) return;
    if (Date.now() >= armed.expiresAtMs) {
        clearPause();
        return;
    }
    observedMutations += 1;
    if (observedMutations !== armed.ordinal) return;
    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(expiryTimer);
            if (heldPause?.release === finish) heldPause = null;
            if (armedPause === armed) armedPause = null;
            resolve();
        };
        const expiryTimer = setTimeout(finish, Math.max(0, armed.expiresAtMs - Date.now()));
        heldPause = { kind: armed.kind, ordinal: armed.ordinal, release: finish };
    });
}
