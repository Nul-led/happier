import { createInterface } from 'node:readline';

import type {
  EphemeralRunnerNativeShellEvent,
  EphemeralRunnerNativeShellPublication,
  EphemeralRunnerNativeShellRequest,
  EphemeralRunnerNativeShellResponse,
  EphemeralRunnerNativeShellTransport,
} from './endpointNativeShellUi';

function parseResponse(value: unknown): EphemeralRunnerNativeShellResponse | null {
  if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('type' in value)) return null;
  if (value.type === 'directory_selected' && 'directory' in value && (typeof value.directory === 'string' || value.directory === null)) {
    return { v: 1, type: 'directory_selected', directory: value.directory };
  }
  if (value.type === 'registry_profile_decision' && 'decision' in value) {
    if (value.decision === 'without_token' || value.decision === 'decline') {
      return { v: 1, type: 'registry_profile_decision', decision: value.decision };
    }
    if (value.decision === 'sign_in' && 'token' in value && typeof value.token === 'string' && value.token.trim()) {
      return { v: 1, type: 'registry_profile_decision', decision: 'sign_in', token: value.token.trim() };
    }
    return null;
  }
  if (value.type === 'consent_decision' && 'decision' in value && (value.decision === 'allow' || value.decision === 'decline')) {
    if (!('optionalSelections' in value) || value.optionalSelections === undefined) {
      return { v: 1, type: 'consent_decision', decision: value.decision };
    }
    const selections = value.optionalSelections;
    if (!Array.isArray(selections) || !selections.every((entry: unknown) => (
      !!entry && typeof entry === 'object'
      && typeof (entry as { accessId?: unknown }).accessId === 'string'
      && typeof (entry as { selected?: unknown }).selected === 'boolean'
    ))) return null;
    return {
      v: 1,
      type: 'consent_decision',
      decision: value.decision,
      optionalSelections: selections.map((entry: { accessId: string; selected: boolean }) => ({
        accessId: entry.accessId,
        selected: entry.selected,
      })),
    };
  }
  if (value.type === 'active_close_decision' && 'decision' in value && (value.decision === 'stop' || value.decision === 'keep_open')) {
    return { v: 1, type: 'active_close_decision', decision: value.decision };
  }
  if (value.type === 'failure_recovery_decision' && 'decision' in value && (value.decision === 'retry' || value.decision === 'exit')) {
    return { v: 1, type: 'failure_recovery_decision', decision: value.decision };
  }
  return null;
}

function parseEvent(value: unknown): EphemeralRunnerNativeShellEvent | null {
  if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('type' in value)) return null;
  if (value.type === 'stop_session') return { v: 1, type: 'stop_session' };
  if (value.type === 'close_requested') return { v: 1, type: 'close_requested' };
  return null;
}

/** Process-local JSON-lines carrier between the signed native shell and Bun core. */
export function createEphemeralRunnerNativeShellStdioTransport(input: Readonly<{
  readable?: NodeJS.ReadableStream;
  write?: (line: string) => void;
}> = {}): EphemeralRunnerNativeShellTransport {
  const readable = input.readable ?? process.stdin;
  const write = input.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pending = new Map<number, Readonly<{
    resolve: (value: EphemeralRunnerNativeShellResponse) => void;
    reject: (error: Error) => void;
  }>>();
  const listeners = new Set<(event: EphemeralRunnerNativeShellEvent) => void>();
  let nextId = 1;
  let disconnected = false;
  /**
   * The shell process owns this carrier. When it dies — killed, desktop session
   * ended, crash — the endpoint has no surface left, so no outstanding decision
   * can ever be answered and the peer pipe is broken. Failing every request and
   * announcing the loss once is what lets the endpoint controller shut down
   * instead of waiting forever with a live Session credential.
   */
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    for (const [requestId, entry] of [...pending]) {
      pending.delete(requestId);
      entry.reject(new Error('runner_native_shell_disconnected'));
    }
    for (const listener of [...listeners]) listener({ v: 1, type: 'shell_disconnected' });
  };
  const lines = createInterface({ input: readable });
  lines.on('close', disconnect);
  lines.on('line', (line) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1) return;
    if ('requestId' in value && typeof value.requestId === 'number' && 'response' in value) {
      const response = parseResponse(value.response);
      if (!response) return;
      const entry = pending.get(value.requestId);
      if (!entry) return;
      pending.delete(value.requestId);
      entry.resolve(response);
    } else if ('event' in value && value.event && typeof value.event === 'object') {
      const event = parseEvent(value.event);
      if (event) for (const listener of listeners) listener(event);
    }
  });
  return Object.freeze({
    request(message, signal) {
      const requestId = nextId++;
      return new Promise<EphemeralRunnerNativeShellResponse>((resolve, reject) => {
        if (disconnected) { reject(new Error('runner_native_shell_disconnected')); return; }
        const onAbort = () => { pending.delete(requestId); reject(new Error('runner_native_shell_request_aborted')); };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.set(requestId, {
          resolve: (response) => { signal.removeEventListener('abort', onAbort); resolve(response); },
          reject: (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
        });
        write(JSON.stringify({ v: 1, requestId, request: message }));
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // Writing to the dead shell's pipe raises EPIPE, which would abort the very
    // shutdown this disconnect started.
    publish(message) { if (!disconnected) write(JSON.stringify({ v: 1, publication: message })); },
    /**
     * Released by the lifecycle that created this carrier, on every terminal
     * outcome and before a retry replaces the application. An open readline
     * interface holds the shell-owned stdin, and that keeps the runtime alive
     * after the entry point returns — the process the user can no longer close.
     * Closing the interface runs the same `close` disconnect a dead shell does,
     * so the terminal state is the one already specified, and repeating it is a
     * no-op.
     */
    dispose() { lines.close(); },
  });
}
