import * as React from 'react';

/**
 * Which machine a Session uses for computer use, as this device has learned it from the surfaces that
 * already read it (an approval, a transcript row, the picker, the viewer). It is a hint for where to ask,
 * never a fact about the share: the computer owner on that machine answers whether a window is shared
 * and who is in control. Kept so the session-wide line can ask the right machine without every Session
 * that never used a computer issuing a machine RPC on open.
 */
type Entry = Readonly<{ machineId: string; machineName: string | null }>;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

// Keyed by Session id alone: surfaces differ in whether they know the Home id, and a hint asked of the
// wrong Home only fails closed at that Home.
function keyOf(sessionId: string): string {
    return sessionId.trim();
}

export function noteSessionComputerMachine(input: Readonly<{
    sessionId: string;
    machineId: string;
    machineName?: string | null;
}>): void {
    const machineId = input.machineId.trim();
    if (!input.sessionId.trim() || !machineId) return;
    const key = keyOf(input.sessionId);
    const previous = entries.get(key);
    const machineName = input.machineName?.trim() || (previous?.machineId === machineId ? previous.machineName : null);
    if (previous && previous.machineId === machineId && previous.machineName === machineName) return;
    entries.set(key, { machineId, machineName });
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function useSessionComputerMachine(sessionId: string | null): Entry | null {
    const key = sessionId ? keyOf(sessionId) : null;
    return React.useSyncExternalStore(
        subscribe,
        () => (key ? entries.get(key) ?? null : null),
        () => null,
    );
}
