import type { DeclarativeActionAffordance } from '@/components/plugins/shared/declarativeNodes';
import { readDeclarativeRecord } from '@/components/plugins/shared/declarativeNodes';

/**
 * The Session declarative adapter's half of the host-Action seam.
 *
 * PEP owns the declarative grammar and the shared renderer: a `kind:'action'` node
 * carries exactly one of `action` (plugin-qualified), `effect`, or `hostAction`
 * (a canonical host `ActionId`), and the ONE renderer in
 * `@/components/plugins/shared/declarativeNodes` asks its consumer to resolve it.
 *
 * A Session Board record is authored content, not an installed plugin. It therefore
 * resolves ONLY `hostAction`, and only through the canonical UI Action executor with
 * the current Session and Lane 04 capability context. A plugin-qualified `action` or
 * an `effect` in a Session document resolves to nothing: a stored document must never
 * manufacture plugin identity, generation, or authority.
 *
 * This module adds no grammar. It reads the producer's field and hands the id to the
 * executor, which remains the sole owner of Action validity, admission, approval and
 * dispatch.
 */

export type SessionBoardHostActionInvocation = Readonly<{
    /** The canonical host Action id the author declared. Validated by the executor. */
    actionId: string;
    /** The author's declared input, passed through unchanged for the executor to parse. */
    input?: unknown;
}>;

export type SessionBoardHostActionBinding = Readonly<{
    /**
     * Whether this mount may invoke host Actions at all: the current viewer has the
     * required Session capability and this placement is the executable mount. When
     * false, declared Actions stay visible and truthfully disabled rather than
     * silently disappearing from the author's content.
     */
    enabled: boolean;
    /** An invocation is in flight; the renderer shows the affordance busy. */
    pending?: boolean;
    invoke: (invocation: SessionBoardHostActionInvocation) => void;
}>;

/** Read the producer-owned `hostAction` field without interpreting the grammar further. */
export function readSessionBoardHostActionId(node: Readonly<Record<string, unknown>>): string | null {
    const hostAction = node.hostAction;
    if (typeof hostAction !== 'string') return null;
    const trimmed = hostAction.trim();
    if (trimmed.length === 0) return null;
    // Exactly one of action/effect/hostAction is authored. A Session record that
    // also carries plugin-qualified or effect arms is not a host Action request.
    if (readDeclarativeRecord(node.action) !== null || typeof node.action === 'string') return null;
    if (node.effect !== undefined) return null;
    return trimmed;
}

/**
 * Build the `resolveAction` the shared declarative renderer injects.
 *
 * Returns `null` for anything that is not a host Action so the renderer degrades to
 * its existing non-interactive presentation instead of inventing a dispatch path.
 */
export function createSessionBoardHostActionResolver(
    binding: SessionBoardHostActionBinding | null,
): (node: Readonly<Record<string, unknown>>) => DeclarativeActionAffordance | null {
    return (node) => {
        const actionId = readSessionBoardHostActionId(node);
        if (actionId === null) return null;
        const authorEnabled = node.enabled !== false;
        const pending = binding?.pending === true;
        const enabled = binding !== null && binding.enabled && authorEnabled && !pending;
        return Object.freeze({
            key: actionId,
            disabled: !enabled,
            busy: pending,
            ...(enabled && binding
                ? {
                    onPress: () => binding.invoke(Object.freeze({
                        actionId,
                        ...(node.input === undefined ? {} : { input: node.input }),
                    })),
                }
                : {}),
        });
    };
}
