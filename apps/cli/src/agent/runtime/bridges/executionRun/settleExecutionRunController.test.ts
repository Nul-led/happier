import { describe, expect, it, vi } from 'vitest';

import { settleExecutionRunController } from './settleExecutionRunController';

describe('settleExecutionRunController', () => {
  it('awaits this runtime permission cleanup before retiring the controller', async () => {
    let finishPermissionCleanup!: () => void;
    const abortPendingPermissionRequests = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishPermissionCleanup = resolve;
      });
    });
    const resolveTerminal = vi.fn();
    const controller = {
      kind: 'backend',
      backend: {
        abortPendingPermissionRequests,
        dispose: vi.fn(async () => undefined),
      },
      settlementPromise: null,
      terminalMarkerWritePromise: Promise.resolve(),
      admittedLiveInterventions: [],
      admittedLiveInterventionsSignal: null,
      resolveTerminal,
    } as never;
    const siblingAbortPendingPermissionRequests = vi.fn(async () => undefined);
    const sibling = {
      kind: 'backend',
      backend: {
        abortPendingPermissionRequests: siblingAbortPendingPermissionRequests,
        dispose: vi.fn(async () => undefined),
      },
    } as never;
    const controllers = new Map([
      ['run-1', controller],
      ['run-2', sibling],
    ]);

    const settlement = settleExecutionRunController({ runId: 'run-1', controller, controllers });
    await vi.waitFor(() => expect(abortPendingPermissionRequests).toHaveBeenCalledOnce());
    expect(resolveTerminal).not.toHaveBeenCalled();
    expect(controllers.get('run-2')).toBe(sibling);
    expect(siblingAbortPendingPermissionRequests).not.toHaveBeenCalled();

    finishPermissionCleanup();
    await settlement;

    expect(resolveTerminal).toHaveBeenCalledOnce();
    expect(controllers.has('run-1')).toBe(false);
    expect(controllers.get('run-2')).toBe(sibling);
  });

  it('settles the terminal marker before backend disposal releases cleanup custody', async () => {
    let markerSettled = false;
    let settleMarker!: () => void;
    const terminalMarkerWritePromise = new Promise<void>((resolve) => {
      settleMarker = () => {
        markerSettled = true;
        resolve();
      };
    });
    const dispose = vi.fn(async () => {
      expect(markerSettled).toBe(true);
      await new Promise<never>(() => undefined);
    });
    const resolveTerminal = vi.fn();
    const controller = {
      kind: 'backend',
      backend: { dispose },
      settlementPromise: null,
      terminalMarkerWritePromise,
      admittedLiveInterventions: [],
      admittedLiveInterventionsSignal: null,
      resolveTerminal,
    } as never;
    const controllers = new Map([['run-1', controller]]);

    const settlement = settleExecutionRunController({
      runId: 'run-1',
      controller,
      controllers,
    });
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();

    settleMarker();
    await settlement;

    expect(dispose).toHaveBeenCalledOnce();
    expect(resolveTerminal).toHaveBeenCalledOnce();
    expect(controllers.has('run-1')).toBe(false);

    await settleExecutionRunController({
      runId: 'run-1',
      controller,
      controllers,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
