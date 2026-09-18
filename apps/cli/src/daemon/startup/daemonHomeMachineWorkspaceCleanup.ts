export type DaemonHomeMachineWorkspaceCleanup = Readonly<{
  stopWorkspaceSync(): Promise<void>;
  stopMachineAcceptor(): Promise<void>;
  stopPeerMediation(): Promise<void>;
  stopDirectPeer(): Promise<void>;
  releaseHomeTransport(): Promise<void>;
  shutdownMachineIroh(): Promise<void>;
  cleanupFailedIrohStartup(): Promise<void>;
}>;

/** Attempts the full daemon-owned Home/Machine/workspace cleanup corridor. */
export async function cleanupDaemonHomeMachineWorkspace(
  cleanup: DaemonHomeMachineWorkspaceCleanup,
): Promise<void> {
  const failures: unknown[] = [];
  // Workspace sync, the acceptor and the peer servers drain first because they
  // depend on the Machine endpoint. Native Machine shutdown then runs before the
  // Home transport release: the native endpoint is the admission, cancellation
  // and join owner, and a Home release parked on an uncancelled reacquisition
  // would otherwise withhold the very cancellation it is waiting for.
  for (const action of [
    cleanup.stopWorkspaceSync,
    cleanup.stopMachineAcceptor,
    cleanup.stopPeerMediation,
    cleanup.stopDirectPeer,
    cleanup.shutdownMachineIroh,
    cleanup.releaseHomeTransport,
    cleanup.cleanupFailedIrohStartup,
  ]) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Daemon Home, Machine, and workspace cleanup failed');
  }
}
