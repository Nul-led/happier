import { spawn } from 'node:child_process';

import { launchOwnedTerminalProcess, type OwnedTerminalProcess } from '@/terminal/runtime/ownedTerminalProcess';
import { prepareOwnedTerminalSpawn } from '@/terminal/runtime/terminalLaunchSpec';
import { logger } from '@/ui/logger';

export type AttachedTerminalSupervisor<TTarget> = Readonly<{
  isAttached: () => boolean;
  attach: (target: TTarget) => Promise<boolean>;
  detach: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

async function waitForExit(proc: OwnedTerminalProcess, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    const finished = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    void proc.whenExited.then(finished, finished);
  });
}

/**
 * `env` lets a provider adapter supply a per-target environment (e.g. the credential of the exact
 * server this terminal attaches to) without mutating `process.env` or leaking secrets through argv.
 * Omitted ⇒ the supervisor's own environment is used.
 */
type AttachedTerminalInvocation = Readonly<{
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}>;

export function createAttachedTerminalSupervisor<TTarget>(params: Readonly<{
  resolveInvocation: (target: TTarget) => Promise<AttachedTerminalInvocation> | AttachedTerminalInvocation;
  spawnProcess?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  detachTimeoutMs?: number;
  onExit?: () => void | Promise<void>;
}>): AttachedTerminalSupervisor<TTarget> {
  const spawnProcess = params.spawnProcess ?? spawn;
  const env = params.env ?? process.env;
  const detachTimeoutMs = Math.max(100, Math.min(60_000, params.detachTimeoutMs ?? 3_000));
  let proc: OwnedTerminalProcess | null = null;
  const intentionallyDetached = new WeakSet<OwnedTerminalProcess>();

  const detach = async (): Promise<void> => {
    const child = proc;
    if (!child) return;
    intentionallyDetached.add(child);
    await child.signal('SIGINT');
    const exitedGracefully = await waitForExit(child, detachTimeoutMs);
    if (!exitedGracefully) {
      await child.signal('SIGKILL');
      await waitForExit(child, detachTimeoutMs);
    }
    if (proc === child) proc = null;
  };

  return {
    isAttached: () => proc !== null,
    attach: async (target) => {
      if (proc) return true;
      const resolution = params.resolveInvocation(target);
      const resolved = resolution && typeof (resolution as PromiseLike<unknown>).then === 'function'
        ? await resolution
        : resolution as AttachedTerminalInvocation;
      const childEnv = resolved.env ?? env;
      const prepared = await prepareOwnedTerminalSpawn({
        command: resolved.command,
        args: [...resolved.args],
        env: childEnv,
        cwd: process.cwd(),
      });
      let child: OwnedTerminalProcess;
      try {
        child = await launchOwnedTerminalProcess({ spawn: prepared, cwd: process.cwd(), spawnProcess });
      } catch {
        logger.infoFile('[terminal] Native terminal could not start (terminal_native_startup_failed)');
        return false;
      }
      proc = child;
      let closeHandled = false;
      const handleClosed = (): void => {
        if (closeHandled) return;
        closeHandled = true;
        if (proc === child) proc = null;
        const wasIntentionallyDetached = intentionallyDetached.delete(child);
        if (!wasIntentionallyDetached) void params.onExit?.();
      };
      void child.whenExited.then(handleClosed, handleClosed);
      return true;
    },
    detach,
    dispose: detach,
  };
}
