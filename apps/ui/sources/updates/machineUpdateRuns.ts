import * as React from 'react';

import { getInstallablesRegistryEntries } from '@/capabilities/installablesRegistry';
import { buildMachineUpdateFactsRequest } from '@/capabilities/requests';
import { prefetchMachineCapabilities } from '@/hooks/server/useMachineCapabilitiesCache';
import { buildAgentCliCapabilityId } from '@/capabilities/agentCliCapabilityId';
import { machineCapabilitiesInvoke } from '@/sync/ops';
import { MACHINE_RPC_POLL_INTERVAL_MS } from '@/sync/ops/machineRpcPollInterval';
import type { AgentId } from '@/agents/catalog/catalog';
import { t } from '@/text';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import type { UpdateItem, UpdateItemStep } from './items/updateItem';
import type { UpdateRunObservation } from './items/buildMachineUpdateItems';
import { recordUpdateCompleted } from './updateCompletions';

export {
    markUpdateCompletionsSeen,
    readUnseenUpdateCompletions,
    recordUpdateCompleted,
    useUnseenUpdateCompletions,
} from './updateCompletions';

/**
 * The one record of machine-side update runs started from this app (agent CLIs, helper
 * installables, another machine's Happier CLI). Each run is the executor's own call — a machine
 * capability invoke or the daemon's `cli.update.v1` system task — and the row reads its lifecycle
 * from here: in flight, failed with one sentence, or (a remote CLI) admitted by its task and waiting
 * for the machine to report the result it persisted. Success is never taken from the call itself: the row
 * re-reads the machine's facts afterwards.
 *
 * Module-level on purpose: the popover and the screen are two views of the same runs.
 */
type RunRecord =
    | Readonly<{ status: 'running' }>
    | Readonly<{ status: 'failed'; message: string; logPath?: string | null }>
    /**
     * A remote CLI update whose task confirmed it admitted the update (started the updater);
     * `baseline` is the machine's last-update fact at that moment.
     */
    | Readonly<{ status: 'accepted'; baseline: string }>
    | Readonly<{ status: 'finished' }>
    /** The runtime found the tool already current: nothing ran, and it is not an "Updated". */
    | Readonly<{ status: 'alreadyCurrent' }>;

type RunRecords = ReadonlyMap<string, RunRecord>;

/**
 * Runs per server scope (`serverId`): a run belongs to the server whose machines it was started on,
 * so switching servers neither shows it on the other server's rows nor redirects its calls.
 */
let recordsByServer: ReadonlyMap<string, RunRecords> = new Map();
const NO_RECORDS: RunRecords = new Map();
const listeners = new Set<() => void>();

function readScope(serverId: string): RunRecords {
    return recordsByServer.get(serverId) ?? NO_RECORDS;
}

function setRecord(serverId: string, itemId: string, record: RunRecord): void {
    const scope = new Map(readScope(serverId));
    scope.set(itemId, record);
    const next = new Map(recordsByServer);
    next.set(serverId, scope);
    recordsByServer = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** One server's runs, outside React (the summary and tests read the same record). */
export function readMachineUpdateRuns(serverId: string): RunRecords {
    return readScope(serverId);
}

export function useMachineUpdateRuns(serverId: string): RunRecords {
    const read = React.useCallback(() => readScope(serverId), [serverId]);
    return React.useSyncExternalStore(subscribe, read, read);
}

const IDLE: UpdateRunObservation = { running: false, step: null, errorMessage: null };

/**
 * What a row's executor currently says. `lastUpdateSignature` is the remote CLI's current
 * last-update fact, so an accepted run stays "running" only until the machine reports anything new.
 */
export function observeMachineUpdateRun(
    runs: RunRecords,
    itemId: string,
    options: Readonly<{ step?: UpdateItemStep; lastUpdateSignature?: string }> = {},
): UpdateRunObservation {
    const record = runs.get(itemId);
    if (!record || record.status === 'finished') return IDLE;
    if (record.status === 'running') return { running: true, step: options.step ?? 'installing', errorMessage: null };
    if (record.status === 'failed') return { running: false, step: null, errorMessage: record.message, logPath: record.logPath ?? null };
    if (record.status === 'alreadyCurrent') return { running: false, step: null, errorMessage: null, alreadyCurrent: true };
    return record.baseline === (options.lastUpdateSignature ?? '')
        ? { running: true, step: 'reconnecting', errorMessage: null }
        : IDLE;
}

export function signatureOfLastUpdate(lastUpdate: unknown): string {
    return lastUpdate == null ? '' : JSON.stringify(lastUpdate);
}

function describeRemoteFailure(code: string | undefined): string {
    // A retryable refusal: the lock may belong to an ordinary install or another channel's
    // activation, which never writes this update's record, so it is not shown as installing.
    if (code === 'cli_update_in_progress') return t('updates.row.anotherUpdateRunning');
    if (code === 'cli_not_managed') return t('machine.thisComputer.cliNotManaged');
    if (code === 'cli_remote_update_unsupported') return t('updates.row.remoteUnsupported');
    return t('updates.row.failedGeneric');
}

/**
 * The runtime's reason when it is one short sentence; raw installer output (several lines, log
 * text) never becomes the row's words — its detail stays behind View log.
 */
function readRuntimeSentence(message: string): string | null {
    const text = message.trim();
    if (!text || text.length > 200 || /[\r\n]/.test(text)) return null;
    return /[.!?…]$/.test(text) ? text : null;
}

/** K6 failure codes → one sentence, when the runtime gave no sentence of its own. */
function describeInstallFailure(code: string | undefined): string {
    if (code === 'update-not-verified') return t('updates.row.updateNotVerified');
    if (code === 'update-not-available') return t('updates.row.updateItYourWay');
    return t('updates.row.failedGeneric');
}

/** Five minutes: the existing installer invoke budget (`InstallableDepInstaller`). */
const INSTALL_INVOKE_TIMEOUT_MS = 5 * 60_000;

type RemoteTaskOutcome =
    | Readonly<{ kind: 'started' }>
    | Readonly<{ kind: 'failed'; code: string | undefined }>
    /** The machine stopped answering before the task said whether it admitted the update. */
    | Readonly<{ kind: 'unknown' }>;

function readTaskResult(value: unknown): Readonly<{ ok: boolean; code?: string }> | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as { ok?: unknown; error?: { code?: unknown } };
    if (record.ok === true) return { ok: true };
    if (record.ok === false) return { ok: false, code: typeof record.error?.code === 'string' ? record.error.code : undefined };
    return null;
}

/**
 * `tool.systemTasks` `start` only returns a task id; the task's own outcome (it started the
 * detached updater, or a named refusal) arrives through `poll`. Ask until the task reports it, at
 * the app's machine-RPC cadence. No deadline is guessed: the task settles as soon as the updater
 * is spawned. A machine that stops answering first leaves the outcome unknown, never admitted.
 */
async function awaitRemoteTaskOutcome(serverId: string, machineId: string, taskId: string): Promise<RemoteTaskOutcome> {
    for (;;) {
        const polled = await machineCapabilitiesInvoke(machineId, {
            id: 'tool.systemTasks',
            method: 'poll',
            params: { taskId, cursor: 0 },
        }, { serverId });
        if (!polled.supported || !polled.response.ok) return { kind: 'unknown' };
        const payload = polled.response.result as { result?: unknown } | null;
        const result = readTaskResult(payload?.result);
        if (result) return result.ok ? { kind: 'started' } : { kind: 'failed', code: result.code };
        await new Promise((resolve) => setTimeout(resolve, MACHINE_RPC_POLL_INTERVAL_MS));
    }
}

async function runRemoteCliUpdate(scope: ServerAccountScope, itemId: string, machineId: string, lastUpdateSignature: string): Promise<void> {
    const serverId = scope.serverId;
    const started = await machineCapabilitiesInvoke(machineId, {
        id: 'tool.systemTasks',
        method: 'start',
        params: { spec: { protocolVersion: 1, kind: 'cli.update.v1', params: {} } },
    }, { serverId });
    if (!started.supported) {
        // A transport loss may still have reached the machine: unknown (Retry), not a refusal.
        setRecord(serverId, itemId, {
            status: 'failed',
            message: started.reason === 'error' ? t('updates.row.outcomeUnknown') : describeRemoteFailure(undefined),
        });
        return;
    }
    if (!started.response.ok) {
        setRecord(serverId, itemId, { status: 'failed', message: describeRemoteFailure(started.response.error.code) });
        return;
    }
    const taskId = (started.response.result as { taskId?: unknown } | null)?.taskId;
    if (typeof taskId !== 'string' || !taskId) {
        setRecord(serverId, itemId, { status: 'failed', message: describeRemoteFailure(undefined) });
        return;
    }
    const outcome = await awaitRemoteTaskOutcome(serverId, machineId, taskId);
    if (outcome.kind === 'unknown') {
        setRecord(serverId, itemId, { status: 'failed', message: t('updates.row.outcomeUnknown') });
        return;
    }
    if (outcome.kind === 'failed') {
        setRecord(serverId, itemId, { status: 'failed', message: describeRemoteFailure(outcome.code) });
        return;
    }
    // Admitted: from here the machine's own `cliUpdate.lastUpdate` says how it ended, including a
    // failure before activation.
    setRecord(serverId, itemId, { status: 'accepted', baseline: lastUpdateSignature });
    recordUpdateCompleted(scope, itemId, 'pendingRemote');
}

/**
 * Re-reads that machine's update facts fresh (the daemon's cache bypassed, each agent CLI with its
 * latest version) through the capability-cache owner, so a finished update resolves its row and
 * the pill count from the machine's own answer.
 */
export function refreshMachineUpdateFacts(serverId: string, machineId: string): void {
    void prefetchMachineCapabilities({ machineId, serverId, request: { ...buildMachineUpdateFactsRequest(), bypassCache: true } });
}

/**
 * Runs one machine row's update through its canonical executor, then re-reads that machine's facts
 * on the same `serverId` (success is re-read, never taken from the call).
 */
export async function runMachineItemUpdate(
    item: UpdateItem,
    context: Readonly<{ scope: ServerAccountScope; lastUpdateSignature?: string }>,
): Promise<void> {
    const machineId = item.machineId;
    if (!machineId || item.action.kind !== 'run') return;
    // Captured once: the run, its polls and its record stay on the server its row came from.
    const scope = context.scope;
    const serverId = scope.serverId;
    if (readScope(serverId).get(item.id)?.status === 'running') return;
    setRecord(serverId, item.id, { status: 'running' });

    const subject = item.subject;
    try {
        if (subject.kind === 'happier-cli') {
            await runRemoteCliUpdate(scope, item.id, machineId, context.lastUpdateSignature ?? '');
            return;
        }

        const request = subject.kind === 'agent-cli'
            // K6 — the catalog install owner, asked for an update of what it installed. Only an
            // explicit press reaches here, and pressing Update is the consent, a vendor's own
            // updater (`native`) included.
            ? {
                id: buildAgentCliCapabilityId(subject.agentId as AgentId),
                method: 'install',
                params: { intent: 'update', allowVendorRecipeExecution: true },
            }
            : subject.kind === 'installable'
                ? (() => {
                    const entry = getInstallablesRegistryEntries().find((candidate) => candidate.key === subject.key);
                    return entry ? { id: entry.capabilityId, method: 'upgrade' } : null;
                })()
                : null;
        if (!request) {
            setRecord(serverId, item.id, { status: 'failed', message: t('updates.row.failedGeneric') });
            return;
        }
        const result = await machineCapabilitiesInvoke(machineId, request, { serverId, timeoutMs: INSTALL_INVOKE_TIMEOUT_MS });
        if (!result.supported) {
            setRecord(serverId, item.id, {
                status: 'failed',
                message: result.reason === 'not-supported' ? t('deps.installNotSupported') : t('updates.row.failedGeneric'),
            });
            return;
        }
        if (!result.response.ok) {
            setRecord(serverId, item.id, {
                status: 'failed',
                message: readRuntimeSentence(result.response.error.message) ?? describeInstallFailure(result.response.error.code),
                logPath: typeof result.response.logPath === 'string' ? result.response.logPath : null,
            });
            return;
        }
        const outcome = result.response.result as { alreadyCurrent?: unknown } | null | undefined;
        if (outcome?.alreadyCurrent === true) {
            setRecord(serverId, item.id, { status: 'alreadyCurrent' });
            return;
        }
        setRecord(serverId, item.id, { status: 'finished' });
        recordUpdateCompleted(scope, item.id);
    } catch {
        setRecord(serverId, item.id, { status: 'failed', message: t('updates.row.failedGeneric') });
    } finally {
        refreshMachineUpdateFacts(serverId, machineId);
    }
}
