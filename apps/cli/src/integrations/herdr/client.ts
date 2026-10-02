import { execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';

import { isSupportedHerdrVersion } from './runtimeBinary';

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

export type HerdrPane = Readonly<{
  paneId: string;
  terminalId: string;
  workspaceId: string;
  tabId: string;
}>;

export type HerdrProcessInfo = Readonly<{
  shellPid: number | null;
  foregroundProcesses: readonly Readonly<{ pid: number; argv: readonly string[] }> [];
}>;

export function readHerdrCreatedWorkspaceTarget(value: unknown): Readonly<{
  workspaceId: string;
  tabId: string;
}> {
  const result = record(value);
  const workspaceId = string(record(result?.workspace)?.workspace_id);
  const tabId = string(record(result?.tab)?.tab_id)
    ?? string(record(result?.workspace)?.active_tab_id);
  if (!workspaceId || !tabId) throw new HerdrApiError('workspace_create_failed');
  return { workspaceId, tabId };
}

export class HerdrApiError extends Error {
  constructor(readonly code: string) {
    super(`Herdr API request failed: ${code}`);
  }
}

/** A submitted layout can start its command even when its response is lost. */
export class HerdrPaneCreationError extends AggregateError {
  readonly code = 'herdr_pane_creation_failed';

  constructor(
    errors: readonly unknown[],
    readonly launchDisposition: 'not_started' | 'stopped' | 'unconfirmed',
    readonly cleanupIncomplete: boolean,
  ) {
    super(errors, launchDisposition === 'unconfirmed'
      ? 'Herdr pane creation could not be confirmed stopped. Its command may still be running; inspect Herdr before retrying.'
      : cleanupIncomplete
        ? 'Herdr pane creation failed and cleanup is incomplete. Inspect Herdr before retrying.'
        : launchDisposition === 'not_started'
          ? 'Herdr pane creation failed; the managed command was not submitted.'
          : 'Herdr pane creation failed; the managed pane was closed.');
    this.name = 'HerdrPaneCreationError';
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paneFrom(value: unknown): HerdrPane {
  const pane = record(value);
  const paneId = string(pane?.pane_id);
  const terminalId = string(pane?.terminal_id);
  const workspaceId = string(pane?.workspace_id);
  const tabId = string(pane?.tab_id);
  if (!paneId || !terminalId || !workspaceId || !tabId) {
    throw new HerdrApiError('invalid_pane_response');
  }
  return { paneId, terminalId, workspaceId, tabId };
}

function request(socketPath: string, method: string, params: JsonRecord, timeoutMs: number): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    let settled = false;
    let buffer = '';
    const finish = (error: Error | null, result?: JsonRecord) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result ?? {});
    };
    socket.setTimeout(timeoutMs, () => finish(new HerdrApiError('timeout')));
    socket.on('error', () => finish(new HerdrApiError('unreachable')));
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 'happier', method, params })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = record(JSON.parse(buffer.slice(0, newline)));
        if (!response) throw new HerdrApiError('invalid_response');
        const error = record(response.error);
        if (error) throw new HerdrApiError(string(error.code) ?? 'unknown_error');
        const result = record(response.result);
        if (!result) throw new HerdrApiError('invalid_response');
        finish(null, result);
      } catch (error) {
        finish(error instanceof Error ? error : new HerdrApiError('invalid_response'));
      }
    });
    socket.on('end', () => finish(new HerdrApiError('connection_closed')));
  });
}

export function createHerdrClient(params: Readonly<{
  binary: string;
  sessionName: string;
  socketPath?: string;
  actionTimeoutMs: number;
  startupTimeoutMs: number;
}>) {
  let socketPath: string | null = params.socketPath ?? null;

  async function listSessions(): Promise<readonly Readonly<{ name: string; socketPath: string; running: boolean }>[]> {
    const { stdout } = await execFileAsync(params.binary, ['session', 'list', '--json'], {
      timeout: params.actionTimeoutMs,
      windowsHide: true,
    });
    const sessions = record(JSON.parse(stdout))?.sessions;
    if (!Array.isArray(sessions)) throw new HerdrApiError('invalid_session_list');
    return sessions.map(record).flatMap((session) => {
      const name = string(session?.name);
      const path = string(session?.socket_path);
      return name && path ? [{ name, socketPath: path, running: session?.running === true }] : [];
    });
  }

  async function findSession(): Promise<Readonly<{ socketPath: string; running: boolean }> | null> {
    return (await listSessions()).find((session) => session.name === params.sessionName) ?? null;
  }

  async function api(method: string, values: JsonRecord = {}): Promise<JsonRecord> {
    if (!socketPath) throw new HerdrApiError('server_not_ready');
    return await request(socketPath, method, values, params.actionTimeoutMs);
  }

  async function assertServerVersion(): Promise<void> {
    const response = await api('session.snapshot');
    const version = string(record(response.snapshot)?.version);
    if (!version || !isSupportedHerdrVersion(version)) {
      throw new HerdrApiError('unsupported_server_version');
    }
  }

  async function ensureServer(): Promise<string> {
    const current = await findSession();
    if (current?.running) {
      socketPath = current.socketPath;
      await assertServerVersion();
      return socketPath;
    }

    const args = params.sessionName === 'default'
      ? ['server']
      : ['--session', params.sessionName, 'server'];
    const server = spawn(params.binary, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    let spawnError: Error | null = null;
    server.once('error', (error) => { spawnError = error; });
    server.unref();
    const deadline = Date.now() + params.startupTimeoutMs;
    while (Date.now() < deadline) {
      const session = await findSession();
      if (spawnError) throw spawnError;
      if (session?.running) {
        socketPath = session.socketPath;
        await assertServerVersion();
        return socketPath;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new HerdrApiError('server_start_timeout');
  }

  async function createPane(input: Readonly<{
    label: string;
    cwd: string;
    argv: readonly string[];
    env: Readonly<Record<string, string>>;
  }>): Promise<HerdrPane> {
    let bootstrapTabId: string | null = null;
    let paneId: string | null = null;
    let layoutSubmitted = false;
    let bootstrapCloseAttempted = false;
    try {
      await ensureServer();
      const snapshot = record((await api('session.snapshot')).snapshot);
      const workspaces = Array.isArray(snapshot?.workspaces) ? snapshot.workspaces.map(record) : [];
      const active = workspaces.find((workspace) => workspace?.focused === true) ?? workspaces[0];
      let workspaceId = string(active?.workspace_id);
      if (!workspaceId) {
        const created = await api('workspace.create', { cwd: input.cwd, focus: false });
        const target = readHerdrCreatedWorkspaceTarget(created);
        workspaceId = target.workspaceId;
        bootstrapTabId = target.tabId;
      }
      layoutSubmitted = true;
      const applied = await api('layout.apply', {
        workspace_id: workspaceId,
        tab_label: input.label,
        focus: false,
        root: {
          type: 'pane',
          label: input.label,
          cwd: input.cwd,
          command: [...input.argv],
          env: input.env,
        },
      });
      paneId = string(record(applied.layout)?.focused_pane_id);
      if (!paneId) throw new HerdrApiError('layout_apply_missing_pane');
      const pane = await api('pane.get', { pane_id: paneId });
      const createdPane = paneFrom(pane.pane);
      if (bootstrapTabId) {
        bootstrapCloseAttempted = true;
        await api('tab.close', { tab_id: bootstrapTabId });
      }
      return createdPane;
    } catch (error) {
      const errors: unknown[] = [error];
      let launchDisposition: HerdrPaneCreationError['launchDisposition'] = layoutSubmitted ? 'unconfirmed' : 'not_started';
      let cleanupIncomplete = bootstrapCloseAttempted;
      if (paneId) {
        try {
          await api('pane.close', { pane_id: paneId });
          launchDisposition = 'stopped';
        } catch (cleanupError) {
          errors.push(cleanupError);
          cleanupIncomplete = true;
        }
      }
      // This tab belongs only to workspace.create, never to an existing workspace.
      // Retire the managed pane first; a failed bootstrap close is not silently retried.
      if (bootstrapTabId && !bootstrapCloseAttempted) {
        try {
          await api('tab.close', { tab_id: bootstrapTabId });
        } catch (cleanupError) {
          errors.push(cleanupError);
          cleanupIncomplete = true;
        }
      }
      throw new HerdrPaneCreationError(errors, launchDisposition, cleanupIncomplete);
    }
  }

  async function findPane(terminalId: string): Promise<HerdrPane | null> {
    const result = await api('pane.list');
    if (!Array.isArray(result.panes)) throw new HerdrApiError('invalid_pane_list');
    const pane = result.panes.map(record).find((item) => item?.terminal_id === terminalId);
    return pane ? paneFrom(pane) : null;
  }

  async function getPane(paneId: string): Promise<HerdrPane> {
    const result = await api('pane.get', { pane_id: paneId });
    return paneFrom(result.pane);
  }

  async function readPane(paneId: string): Promise<string> {
    const result = await api('pane.read', {
      pane_id: paneId,
      source: 'recent',
      lines: 80,
      format: 'ansi',
      strip_ansi: false,
    });
    const value = string(record(result.read)?.text);
    return value ?? '';
  }

  async function sendText(paneId: string, text: string): Promise<void> {
    await api('pane.send_input', { pane_id: paneId, text });
  }

  async function sendRaw(paneId: string, text: string): Promise<void> {
    await api('pane.send_text', { pane_id: paneId, text });
  }

  async function sendKeys(paneId: string, keys: readonly string[]): Promise<void> {
    await api('pane.send_keys', { pane_id: paneId, keys: [...keys] });
  }

  async function processInfo(paneId: string): Promise<HerdrProcessInfo> {
    const response = await api('pane.process_info', { pane_id: paneId });
    const info = record(response.process_info);
    if (!info) throw new HerdrApiError('invalid_process_info');
    const foregroundProcesses = Array.isArray(info.foreground_processes)
      ? info.foreground_processes.map(record).flatMap((process) => {
        const pid = process?.pid;
        const argv = process?.argv;
        return typeof pid === 'number' && Array.isArray(argv) && argv.every((arg) => typeof arg === 'string')
          ? [{ pid, argv: argv as string[] }]
          : [];
      })
      : [];
    return {
      shellPid: typeof info.shell_pid === 'number' ? info.shell_pid : null,
      foregroundProcesses,
    };
  }

  async function closePane(paneId: string): Promise<void> {
    await api('pane.close', { pane_id: paneId });
  }

  return {
    ensureServer,
    assertServerVersion,
    listSessions,
    createPane,
    findPane,
    getPane,
    readPane,
    sendText,
    sendRaw,
    sendKeys,
    processInfo,
    closePane,
    request: api,
    get socketPath() { return socketPath; },
  };
}

export type HerdrClient = ReturnType<typeof createHerdrClient>;
