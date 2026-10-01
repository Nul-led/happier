import { randomUUID } from '@/platform/randomUUID';
import { SESSION_TERMINAL_ACTION_INPUT_SCHEMAS, type SessionTerminalActionId, type SessionTerminalTargetV1 } from '@happier-dev/protocol';
import { parseSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { dispatchSessionTerminalWorkspaceCommand, getSplitMeasurementsForScope, readSessionTerminalWorkspaceForScope, resizeSessionTerminalSplitForScope } from './sessionTerminalWorkspaceRuntime';
import { reduceSessionTerminalWorkspace, type SessionTerminalWorkspaceCommand } from './sessionTerminalWorkspace';
import { closeOwnedSessionTerminals } from './closeOwnedSessionTerminals';

export function sessionTerminalActionFailure(errorCode: string) {
    return { ok: false as const, errorCode, error: errorCode };
}

/** Stateless intent adapter over the mounted AppPane owner and daemon PTY authority. */
export async function invokeSessionTerminalAction(request: Readonly<{
    actionId: SessionTerminalActionId;
    input: unknown;
    signal?: AbortSignal;
}>) {
    if (request.signal?.aborted) return sessionTerminalActionFailure('action_cancelled');
    const parsed = SESSION_TERMINAL_ACTION_INPUT_SCHEMAS[request.actionId].safeParse(request.input);
    if (!parsed.success) return sessionTerminalActionFailure('invalid_parameters');
    const data = parsed.data;
    if (!parseSessionPaneScopeId(data.scopeId)?.address) return sessionTerminalActionFailure('terminal_scope_unavailable');
    const workspace = readSessionTerminalWorkspaceForScope(data.scopeId);
    if (!workspace) return sessionTerminalActionFailure('unsupported_action');
    if (request.actionId === 'session.terminals.list') return { ok: true as const, workspace };
    const tabId = 'tabId' in data ? data.tabId : undefined;
    const tab = workspace.tabs.find((item) => item.id === (tabId ?? workspace.activeTabId));
    if ('terminalId' in data && !workspace.tabs.some((item) => item.terminals.some((member) => member.id === data.terminalId))) {
        return sessionTerminalActionFailure('terminal_not_found');
    }
    let command: SessionTerminalWorkspaceCommand | undefined;
    let terminalId: string | undefined;
    let closedTerminalIds: string[] | undefined;
    switch (request.actionId) {
        case 'session.terminals.open':
        case 'session.terminals.split':
        case 'session.terminals.run_script': {
            const target: SessionTerminalTargetV1 | null = 'target' in data ? data.target
                : 'runTargetId' in data ? { kind: 'machine_shell', machineId: data.machineId, cwd: data.cwd,
                    launch: { kind: 'package_script', runTargetId: data.runTargetId } } : null;
            if (!target) return sessionTerminalActionFailure('invalid_parameters');
            terminalId = randomUUID();
            const terminal = { id: terminalId, target, ...('title' in data && data.title ? { title: data.title } : {}) };
            if (request.actionId === 'session.terminals.split') {
                if (!tab) return sessionTerminalActionFailure('terminal_tab_not_found');
                const measurement = getSplitMeasurementsForScope(data.scopeId, tab.id);
                if (!measurement) return sessionTerminalActionFailure('terminal_layout_unmeasured');
                command = { type: 'split', tabId: tab.id, terminal, ...measurement };
                if (reduceSessionTerminalWorkspace(workspace, command) === workspace) return sessionTerminalActionFailure('terminal_split_unavailable');
            } else command = { type: 'open', terminal };
            break;
        }
        case 'session.terminals.focus':
            if (!('terminalId' in data)) return sessionTerminalActionFailure('invalid_parameters');
            command = { type: 'focus', terminalId: data.terminalId };
            break;
        case 'session.terminals.close':
            if (!('terminalId' in data)) return sessionTerminalActionFailure('invalid_parameters');
            {
                const result = await closeOwnedSessionTerminals({ scopeId: data.scopeId, terminals: workspace.tabs.flatMap((item) => item.terminals).filter((terminal) => terminal.id === data.terminalId), signal: request.signal });
                if (!result.ok) return result;
                closedTerminalIds = [data.terminalId];
            }
            break;
        case 'session.terminals.close_others':
            if (!tab) return sessionTerminalActionFailure('terminal_tab_not_found');
            {
                const selected = workspace.tabs.filter((item) => item.id !== tab.id).flatMap((item) => item.terminals);
                const result = await closeOwnedSessionTerminals({ scopeId: data.scopeId, terminals: selected, signal: request.signal });
                if (!result.ok) return result;
                closedTerminalIds = selected.map((terminal) => terminal.id);
            }
            break;
        case 'session.terminals.close_tab':
            if (!tab) return sessionTerminalActionFailure('terminal_tab_not_found');
            {
                const result = await closeOwnedSessionTerminals({ scopeId: data.scopeId, terminals: tab.terminals, signal: request.signal });
                if (!result.ok) return result;
                closedTerminalIds = tab.terminals.map((terminal) => terminal.id);
            }
            break;
        case 'session.terminals.resize': {
            if (!tab || tab.terminals.length < 2) return sessionTerminalActionFailure('terminal_split_unavailable');
            if (!('ratio' in data && 'splitId' in data)) return sessionTerminalActionFailure('invalid_parameters');
            const resized = resizeSessionTerminalSplitForScope(data.scopeId, tab.id, data.splitId, data.ratio);
            return resized === null ? sessionTerminalActionFailure('terminal_layout_unmeasured')
                : resized ? { ok: true as const } : sessionTerminalActionFailure('terminal_split_unavailable');
        }
        case 'session.terminals.detach':
            if (!('terminalId' in data)) return sessionTerminalActionFailure('invalid_parameters');
            command = { type: 'detach', terminalId: data.terminalId, newTabId: randomUUID() };
            break;
        case 'session.terminals.reorder':
            if (!tab) return sessionTerminalActionFailure('terminal_tab_not_found');
            if (!('index' in data)) return sessionTerminalActionFailure('invalid_parameters');
            command = { type: 'reorder', tabId: tab.id, index: data.index };
            break;
        case 'session.terminals.rename':
            if (!('terminalId' in data && 'title' in data)) return sessionTerminalActionFailure('invalid_parameters');
            command = { type: 'rename', terminalId: data.terminalId, title: data.title };
            break;
        case 'session.terminals.list_view':
            if (!('showList' in data)) return sessionTerminalActionFailure('invalid_parameters');
            command = { type: 'showList', showList: data.showList };
            break;
        default: return sessionTerminalActionFailure('unsupported_action');
    }
    if (closedTerminalIds) {
        // RPC waits permit new panes to open or split. Commit only the captured
        // members whose ownership was checked, never newly added shell members.
        for (const id of closedTerminalIds) if (!dispatchSessionTerminalWorkspaceCommand(data.scopeId, { type: 'close', terminalId: id })) return sessionTerminalActionFailure('unsupported_action');
        if (request.actionId === 'session.terminals.close_others' && tab
            && readSessionTerminalWorkspaceForScope(data.scopeId)?.tabs.some((current) => current.id === tab.id)) {
            dispatchSessionTerminalWorkspaceCommand(data.scopeId, { type: 'focus', terminalId: tab.focusedTerminalId });
        }
    } else if (!command || !dispatchSessionTerminalWorkspaceCommand(data.scopeId, command)) return sessionTerminalActionFailure('unsupported_action');
    return terminalId ? { ok: true as const, terminalId } : { ok: true as const };
}
