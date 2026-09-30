/**
 * Terminal prompt helpers
 *
 * Shared interactive input helpers for CLI flows (server add flows, OAuth paste fallback, etc).
 */

import { closeSync, existsSync, openSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';

export type PromptAnimation = Readonly<{
  animate?: boolean;
  intervalMs?: number | ((elapsedSeconds: number) => number);
  render: (elapsedSeconds: number) => string;
  onMove?: (delta: -1 | 1) => void;
  onToggle?: () => void;
  answerOnEmpty?: () => string;
}>;

type PromptOptions = Readonly<{
  secret?: boolean;
  signal?: AbortSignal;
  animation?: PromptAnimation;
}>;
type ReadlineWithOutputInterceptor = Interface & {
  _writeToOutput?: (value: string) => void;
};

async function flushAndEndTtyOutput(output: WriteStream): Promise<void> {
  if (output.destroyed || output.writableEnded) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      output.off('finish', finish);
      output.off('error', finish);
      resolve();
    };
    output.once('finish', finish);
    output.once('error', finish);
    output.end();
  });
}

/**
 * Decide whether we can ask the user a question, given what the process can see.
 *
 * Pure so the `curl | bash` case can be tested without a terminal.
 */
export function resolveInteractiveTerminal(params: Readonly<{
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
  platform: NodeJS.Platform | string;
  hasControllingTty: () => boolean;
}>): boolean {
  if (params.stdinIsTty && params.stdoutIsTty) {
    return true;
  }
  if (params.platform === 'win32') {
    return false;
  }
  return params.hasControllingTty();
}

/**
 * A device node at /dev/tty is not proof of a terminal — in a container it can
 * exist and still fail to open with ENXIO. Opening it is the only real check.
 */
function hasControllingTty(): boolean {
  let fd: number | null = null;
  try {
    fd = openSync('/dev/tty', 'r+');
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best effort: we only opened it to find out whether we could.
      }
    }
  }
}

/**
 * Whether the CLI can prompt.
 *
 * `process.stdin` is not the whole story. Under `curl … | bash -s -- --run <cmd>`
 * the installer hands us an exhausted pipe on stdin while the user is still sat
 * at a terminal — and `promptInput` below already prompts through a freshly
 * opened /dev/tty in exactly that case. Gating on stdin alone makes every
 * installer-invoked command run blind, `happier setup` included.
 */
export function isInteractiveTerminal(): boolean {
  return resolveInteractiveTerminal({
    stdinIsTty: Boolean(process.stdin.isTTY),
    stdoutIsTty: Boolean(process.stdout.isTTY),
    platform: process.platform,
    hasControllingTty,
  });
}

function askQuestion(params: Readonly<{
  rl: Interface;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  prompt: string;
  secret: boolean;
  signal?: AbortSignal;
  animation?: PromptOptions['animation'];
}>): Promise<string> {
  const rl = params.rl as ReadlineWithOutputInterceptor;
  const originalWriteToOutput = rl._writeToOutput;
  const restoreOutput = () => {
    if (originalWriteToOutput) {
      rl._writeToOutput = originalWriteToOutput;
    }
  };
  if (params.secret) {
    params.output.write(params.prompt);
    if (originalWriteToOutput) {
      rl._writeToOutput = () => undefined;
    }
  }
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let animationTimer: ReturnType<typeof setInterval> | null = null;
    let onKeypress: ((value: string, key: Readonly<{ name?: string }>) => void) | null = null;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (animationTimer) clearInterval(animationTimer);
      params.signal?.removeEventListener('abort', onAbort);
      params.rl.removeListener('SIGINT', onAbort);
      params.rl.removeListener('close', onClose);
      if (onKeypress) params.input.removeListener('keypress', onKeypress);
      restoreOutput();
      if (params.secret) {
        params.output.write('\n');
      }
      settle();
    };
    const onAbort = (): void => {
      const error = new Error('Terminal prompt aborted');
      error.name = 'AbortError';
      finish(() => reject(error));
    };
    const onClose = (): void => {
      const error = new Error('Terminal prompt closed');
      error.name = 'AbortError';
      finish(() => reject(error));
    };
    if (params.signal?.aborted) {
      onAbort();
      return;
    }
    params.rl.once('SIGINT', onAbort);
    params.rl.once('close', onClose);
    params.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (params.animation) {
        const startedAt = Date.now();
        const initialColumns = process.stdout.columns;
        const initialRows = process.stdout.rows;
        let redrawEnabled = true;
        const canRedraw = (): boolean => {
          const cursor = params.rl.getCursorPos();
          return process.stdout.columns === initialColumns
            && process.stdout.rows === initialRows
            && !(typeof initialRows === 'number' && cursor.rows >= initialRows - 1);
        };
        const stopRedraw = (): void => {
            if (animationTimer) clearInterval(animationTimer);
            animationTimer = null;
            redrawEnabled = false;
        };
        const redraw = (): void => {
          if (!canRedraw()) {
            stopRedraw();
            return;
          }
          const elapsedSeconds = params.animation!.animate === false ? 0 : (Date.now() - startedAt) / 1000;
          params.rl.setPrompt(params.animation!.render(elapsedSeconds));
          // Readline redraws its owned prompt and current input together. This
          // preserves partial and wrapped input instead of racing terminal writes.
          params.rl.prompt(true);
        };
        onKeypress = (_value, key) => {
          if (key.name === 'escape') {
            onAbort();
            return;
          }
          const isToggle = key.name === 'space' || _value === ' ';
          if (!redrawEnabled || (key.name !== 'up' && key.name !== 'down' && !isToggle)) return;
          if (!canRedraw()) {
            stopRedraw();
            return;
          }
          if (isToggle) {
            params.animation!.onToggle?.();
            // Space is an action in a multi-select prompt, not readline input.
            params.rl.write(null, { ctrl: true, name: 'u' });
          } else {
            params.animation!.onMove?.(key.name === 'up' ? -1 : 1);
          }
          redraw();
        };
        params.input.on('keypress', onKeypress);
        if (params.animation.animate !== false) {
          const interval = params.animation.intervalMs;
          animationTimer = setInterval(redraw, Math.max(40, (typeof interval === 'function' ? interval(0) : interval) ?? 120));
          animationTimer.unref?.();
        }
      }
      params.rl.question(params.secret ? '' : params.prompt, (value) => {
        const answer = value === '' ? params.animation?.answerOnEmpty?.() ?? value : value;
        finish(() => resolve(answer));
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function promptViaDevTty(prompt: string, options: PromptOptions): Promise<string | null> {
  if (process.platform === 'win32' || !existsSync('/dev/tty')) {
    return null;
  }

  let inputFd: number | null = null;
  let outputFd: number | null = null;
  let input: ReadStream | null = null;
  let output: WriteStream | null = null;
  try {
    inputFd = openSync('/dev/tty', 'r+');
    outputFd = openSync('/dev/tty', 'r+');
    input = new ReadStream(inputFd);
    inputFd = null;
    output = new WriteStream(outputFd);
    outputFd = null;
  } catch {
    input?.destroy();
    output?.destroy();
    if (inputFd !== null) closeSync(inputFd);
    if (outputFd !== null) closeSync(outputFd);
    return null;
  }

  let rl: Interface | null = null;

  try {
    rl = createInterface({ input, output, terminal: true });
    return await askQuestion({
      rl,
      input,
      output,
      prompt,
      secret: options.secret === true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.animation ? { animation: options.animation } : {}),
    });
  } finally {
    rl?.close();
    input?.destroy();
    if (output) await flushAndEndTtyOutput(output);
    output?.destroy();
  }
}

async function promptViaProcessStdio(prompt: string, options: PromptOptions): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await askQuestion({
      rl,
      input: process.stdin,
      output: process.stdout,
      prompt,
      secret: options.secret === true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.animation ? { animation: options.animation } : {}),
    });
  } finally {
    rl.close();
  }
}

export async function promptInput(
  prompt: string,
  options: Readonly<{
    signal?: AbortSignal;
    animation?: PromptAnimation;
  }> = {},
): Promise<string> {
  const staticOptions = options.signal ? { signal: options.signal } : {};
  if (!isInteractiveTerminal()) {
    return promptViaProcessStdio(prompt, staticOptions);
  }

  // Animation uses readline's direct terminal-mode prompt redraw. A controlling
  // /dev/tty reached through redirected stdio remains a correct static prompt.
  if (options.animation && process.stdin.isTTY && process.stdout.isTTY) {
    return promptViaProcessStdio(prompt, options);
  }

  const ttyAnswer = await promptViaDevTty(prompt, staticOptions);
  if (ttyAnswer !== null) {
    return ttyAnswer;
  }

  return promptViaProcessStdio(prompt, staticOptions);
}

export async function promptSecretInput(prompt: string): Promise<string> {
  if (!isInteractiveTerminal()) {
    return promptViaProcessStdio(prompt, { secret: true });
  }

  const ttyAnswer = await promptViaDevTty(prompt, { secret: true });
  if (ttyAnswer !== null) {
    return ttyAnswer;
  }

  return promptViaProcessStdio(prompt, { secret: true });
}
