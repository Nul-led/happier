import type { SessionTerminalMemberV1 } from '@happier-dev/protocol/terminal';
import { awaitPendingMachineTerminalCreation, machineTerminalClose, machineTerminalList } from '@/sync/ops/machineTerminal';
import { parseSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { resolveSessionTerminalIdentity } from './sessionTerminalMode';
import { createEmptyTerminalSurfaceState, readTerminalSurfaceState, replaceTerminalSurfaceState } from './terminalSurfaceStateCache';

/** Pane ownership never implies ownership of an agent or a borrowed terminal. */
export async function closeOwnedSessionTerminals(input: Readonly<{
    scopeId: string; terminals: readonly SessionTerminalMemberV1[]; signal?: AbortSignal;
}>): Promise<{ ok: true } | { ok: false; errorCode: string; error: string }> {
    const failed = (errorCode: string) => ({ ok: false as const, errorCode, error: errorCode });
    const address = parseSessionPaneScopeId(input.scopeId)?.address;
    if (!address) return failed('terminal_scope_unavailable');
    const owned = input.terminals.filter((terminal) => terminal.target.kind === 'workspace_shell' || terminal.target.kind === 'machine_shell');
    if (owned.length === 0) return { ok: true };
    try {
        const identities: { machineId: string; terminalKey: string }[] = [];
        for (const terminal of owned) {
            let machineId: string | undefined;
            if (terminal.target.kind === 'machine_shell') machineId = terminal.target.machineId;
            else {
                const [{ getStorage }, { resolveMachineTargetForSessionFromState }] = await Promise.all([
                    import('@/sync/domains/state/storage'), import('@/sync/domains/session/resolveMachineTargetForSessionFromState'),
                ]);
                machineId = resolveMachineTargetForSessionFromState(getStorage().getState(), address)?.machineId;
            }
            if (!machineId) return failed('terminal_target_unavailable');
            identities.push({ machineId, terminalKey: resolveSessionTerminalIdentity({ sessionId: address.sessionId, scopeId: input.scopeId, terminal }).terminalKey });
        }
        // Resolve every required identity before stopping any process. Listing is
        // authoritative even when the bounded output projection was evicted.
        const lists = new Map<string, Awaited<ReturnType<typeof machineTerminalList>>>();
        const closable: { machineId: string; terminalId: string; terminalKey: string }[] = [];
        await Promise.all(identities.map((identity) => awaitPendingMachineTerminalCreation(identity.machineId, identity.terminalKey, { serverId: address.serverId })));
        for (const identity of identities) {
            if (input.signal?.aborted) return failed('action_cancelled');
            if (!lists.has(identity.machineId)) lists.set(identity.machineId, await machineTerminalList(identity.machineId, { serverId: address.serverId, signal: input.signal }));
            const list = lists.get(identity.machineId);
            if (list && !list.ok) return failed(list.errorCode);
            const terminalId = list?.ok
                ? list.terminals.find((terminal) => terminal.terminalKey === identity.terminalKey)?.terminalId
                : readTerminalSurfaceState(identity.terminalKey)?.terminalId;
            if (!list && !terminalId) return failed('terminal_close_identity_unavailable');
            if (terminalId) closable.push({ ...identity, terminalId });
        }
        for (const terminal of closable) {
            if (input.signal?.aborted) return failed('action_cancelled');
            const outcome = await machineTerminalClose(terminal.machineId, { terminalId: terminal.terminalId }, { serverId: address.serverId, signal: input.signal });
            if (!outcome.ok) return failed(outcome.errorCode);
        }
        for (const identity of identities) replaceTerminalSurfaceState(identity.terminalKey, createEmptyTerminalSurfaceState());
        return { ok: true };
    } catch {
        return failed(input.signal?.aborted ? 'action_cancelled' : 'terminal_close_unavailable');
    }
}
