type LifecycleEventSource = Readonly<{
  once: (event: string, listener: () => void) => unknown;
  off: (event: string, listener: () => void) => unknown;
}>;

type CloseAware = {
  onclose?: (() => void) | null;
};

export async function runMcpStdioBridgeLifecycle(params: Readonly<{
  stdin: LifecycleEventSource & Readonly<{ readableEnded?: boolean; destroyed?: boolean }>;
  signals?: LifecycleEventSource;
  start: () => Promise<Readonly<{ transport: CloseAware; upstream?: CloseAware }>>;
  closeServer: () => Promise<unknown>;
  closeUpstream?: () => Promise<unknown>;
}>): Promise<NodeJS.Signals | null> {
  const signals = params.signals ?? {
    once: (event: string, listener: () => void) => process.once(event as NodeJS.Signals, listener),
    off: (event: string, listener: () => void) => process.off(event as NodeJS.Signals, listener),
  };
  let resolveShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  let shutdownStarted = false;
  let requestedSignal: NodeJS.Signals | null = null;
  let transport: CloseAware | null = null;
  let upstream: CloseAware | null = null;
  let previousTransportOnClose: (() => void) | null | undefined;
  let previousUpstreamOnClose: (() => void) | null | undefined;

  const requestShutdown = (signal: NodeJS.Signals | null = null) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    requestedSignal = signal;
    resolveShutdown();
  };
  const onStdinEnd = () => requestShutdown();
  const onStdinError = () => requestShutdown();
  const onSigint = () => requestShutdown('SIGINT');
  const onSigterm = () => requestShutdown('SIGTERM');
  const onTransportClose = () => {
    try {
      previousTransportOnClose?.();
    } finally {
      requestShutdown();
    }
  };
  const onUpstreamClose = () => {
    try {
      previousUpstreamOnClose?.();
    } finally {
      requestShutdown();
    }
  };

  params.stdin.once('end', onStdinEnd);
  params.stdin.once('error', onStdinError);
  signals.once('SIGINT', onSigint);
  signals.once('SIGTERM', onSigterm);

  try {
    const started = await params.start();
    transport = started.transport;
    upstream = started.upstream ?? null;
    previousTransportOnClose = transport.onclose;
    transport.onclose = onTransportClose;
    if (upstream) {
      previousUpstreamOnClose = upstream.onclose;
      upstream.onclose = onUpstreamClose;
    }
    if (params.stdin.readableEnded || params.stdin.destroyed) requestShutdown();
    await shutdownRequested;
  } finally {
    params.stdin.off('end', onStdinEnd);
    params.stdin.off('error', onStdinError);
    signals.off('SIGINT', onSigint);
    signals.off('SIGTERM', onSigterm);
    if (transport?.onclose === onTransportClose) transport.onclose = previousTransportOnClose;
    if (upstream?.onclose === onUpstreamClose) upstream.onclose = previousUpstreamOnClose;

    const cleanup = await Promise.allSettled([
      params.closeServer(),
      params.closeUpstream?.() ?? Promise.resolve(),
    ]);
    const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'MCP stdio bridge cleanup failed');
    }
  }

  return requestedSignal;
}
