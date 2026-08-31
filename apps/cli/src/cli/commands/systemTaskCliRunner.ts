import {
  type SystemTaskEvent,
  type SystemTaskJsonObject,
  type SystemTaskResult,
  type SystemTaskSpec,
} from '@happier-dev/protocol';

export type CliSystemTasksRunnerAdapter = Readonly<{
  start: (params: Readonly<{ spec: SystemTaskSpec }>) => Promise<Readonly<{ taskId: string }>>;
  poll: (params: Readonly<{ taskId: string; cursor: number }>) => Promise<Readonly<{
    events: SystemTaskEvent[];
    nextCursor: number;
    result: SystemTaskResult | null;
    pendingPrompt: Readonly<{ kind: string; data: SystemTaskJsonObject }> | null;
  }>>;
  respond: (params: Readonly<{ taskId: string; answer: unknown }>) => Promise<void>;
}>;

type TaskPrompt = Readonly<{ kind: string; data: SystemTaskJsonObject }>;

function cancelledError(): Error & Readonly<{ code: 'cancelled' }> {
  return Object.assign(new Error('System task execution was cancelled.'), { code: 'cancelled' as const });
}

function promptFromEvent(event: SystemTaskEvent): TaskPrompt | null {
  if (event.type !== 'prompt' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const kind = typeof (event.data as SystemTaskJsonObject).kind === 'string'
    ? String((event.data as SystemTaskJsonObject).kind).trim()
    : '';
  return kind ? { kind, data: event.data as SystemTaskJsonObject } : null;
}

/**
 * The single CLI start/poll/respond loop for live system tasks. Command owners provide only
 * presentation and prompt policy; cursor progression, cancellation checks and task failure
 * propagation stay identical for every caller.
 */
export async function runSystemTaskToCompletion(params: Readonly<{
  runner: CliSystemTasksRunnerAdapter;
  spec: SystemTaskSpec;
  signal?: AbortSignal;
  onEvent?: (event: SystemTaskEvent) => Promise<void> | void;
  onPrompt?: (prompt: TaskPrompt, message: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}>): Promise<SystemTaskResult> {
  if (params.signal?.aborted) throw cancelledError();
  const { taskId } = await params.runner.start({ spec: params.spec });
  let cursor = 0;
  let lastPromptMessage = '';
  const sleep = params.sleep ?? (async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)));

  while (true) {
    if (params.signal?.aborted) throw cancelledError();
    const snapshot = await params.runner.poll({ taskId, cursor });
    cursor = snapshot.nextCursor;
    let promptFromEvents: TaskPrompt | null = null;

    for (const event of snapshot.events) {
      if (event.type === 'prompt') {
        lastPromptMessage = event.message ?? '';
        promptFromEvents = promptFromEvent(event) ?? promptFromEvents;
      }
      await params.onEvent?.(event);
    }

    const prompt = snapshot.pendingPrompt ?? promptFromEvents;
    if (prompt) {
      if (!params.onPrompt) throw Object.assign(new Error(`System task requires unsupported input: ${prompt.kind}`), { code: 'prompt_required' });
      const answer = await params.onPrompt(prompt, lastPromptMessage);
      await params.runner.respond({ taskId, answer });
      lastPromptMessage = '';
      continue;
    }

    if (snapshot.result) return snapshot.result;
    if (params.signal?.aborted) throw cancelledError();
    await sleep(params.pollIntervalMs ?? 50);
  }
}
