import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';


const platformRef = vi.hoisted(() => ({ value: 'linux' }));
// Minimal stdio boundary fixtures: promptInput reads `isTTY` and passes stream identity to readline.
const stdinRef = vi.hoisted(() => ({ value: { isTTY: true, label: 'stdin' } as unknown as NodeJS.ReadStream }));
const stdoutRef = vi.hoisted(() => ({ value: { isTTY: true, label: 'stdout' } as unknown as NodeJS.WriteStream }));
const existsSyncMock = vi.hoisted(() => vi.fn(() => false));
const openSyncMock = vi.hoisted(() => vi.fn());
const ttyReadStreamMock = vi.hoisted(() => vi.fn());
const ttyWriteStreamMock = vi.hoisted(() => vi.fn());
const createInterfaceMock = vi.hoisted(() => vi.fn());

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process') & { default?: NodeJS.Process }>();
  return {
    ...actual,
    default: new Proxy(actual.default ?? globalThis.process, {
      get(target, prop, receiver) {
        if (prop === 'platform') return platformRef.value;
        if (prop === 'stdin') return stdinRef.value;
        if (prop === 'stdout') return stdoutRef.value;
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    openSync: openSyncMock,
  };
});

vi.mock('node:tty', () => ({
  ReadStream: ttyReadStreamMock,
  WriteStream: ttyWriteStreamMock,
}));

vi.mock('node:readline', () => ({
  createInterface: createInterfaceMock,
}));

function createPromptRl(answer: string, onQuestion?: () => void) {
  const rl = new EventEmitter() as EventEmitter & {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  rl.question = vi.fn((_prompt: string, resolve: (value: string) => void) => {
    onQuestion?.();
    resolve(answer);
  });
  rl.close = vi.fn();
  return rl;
}

describe('promptInput', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    platformRef.value = 'linux';
    stdinRef.value = Object.assign(new EventEmitter(), { isTTY: true, label: 'stdin' }) as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: true, label: 'stdout' } as unknown as NodeJS.WriteStream;
    existsSyncMock.mockReturnValue(false);
    openSyncMock.mockReset().mockImplementation(() => {
      const error = new Error('no controlling tty') as NodeJS.ErrnoException;
      error.code = 'ENXIO';
      throw error;
    });
    ttyReadStreamMock.mockReset();
    ttyWriteStreamMock.mockReset();
    createInterfaceMock.mockReset();
  });

  it('lets the multi-select choose multiple ids or explicit skip through the real static prompt boundary', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: false, label: 'stdout-pipe' } as unknown as NodeJS.WriteStream;
    createInterfaceMock
      .mockReturnValueOnce(createPromptRl('1,codex'))
      .mockReturnValueOnce(createPromptRl('skip'));
    const { promptMultipleSelection } = await import('./promptMultipleChoice');
    const options = [
      { id: 'claude', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' },
      { id: 'skip', label: 'Skip for now', kind: 'skip' as const },
    ];

    await expect(promptMultipleSelection('Choose agents', options)).resolves.toEqual(['claude', 'codex']);
    await expect(promptMultipleSelection('Choose agents', options)).resolves.toEqual([]);
  });

  it('keeps the controlling-/dev/tty fallback static when process stdin is piped', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: true, label: 'stdout-tty' } as unknown as NodeJS.WriteStream;
    existsSyncMock.mockReturnValue(true);
    openSyncMock.mockReturnValueOnce(39).mockReturnValueOnce(40).mockReturnValueOnce(41);
    const input = new PassThrough();
    const output = new PassThrough();
    ttyReadStreamMock.mockReturnValue(input);
    ttyWriteStreamMock.mockReturnValue(output);
    const rl = createPromptRl('piped value');
    createInterfaceMock.mockReturnValue(rl);
    const render = vi.fn(() => 'animated frame');

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ', { animation: { render } })).resolves.toBe('piped value');

    expect(openSyncMock).toHaveBeenCalledTimes(3);
    expect(createInterfaceMock).toHaveBeenCalledWith({
      input,
      output,
      terminal: true,
    });
    expect(render).not.toHaveBeenCalled();
    expect(rl.close).toHaveBeenCalledTimes(1);
  });

  it('redraws an animated multiline prompt through readline while preserving input and stops on resize', async () => {
    vi.useFakeTimers();
    existsSyncMock.mockReturnValue(true);
    stdinRef.value = Object.assign(new EventEmitter(), { isTTY: true, label: 'stdin' }) as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: true, columns: 92, rows: 24, label: 'stdout' } as unknown as NodeJS.WriteStream;
    let answer!: (value: string) => void;
    const rl = Object.assign(new EventEmitter(), {
      line: 'partially typed',
      question: vi.fn((_prompt: string, resolve: (value: string) => void) => {
        answer = resolve;
      }),
      setPrompt: vi.fn(),
      prompt: vi.fn(),
      getCursorPos: vi.fn(() => ({ cols: 12, rows: 3 })),
      close: vi.fn(),
    });
    createInterfaceMock.mockReturnValue(rl);

    const { promptInput } = await import('./promptInput');
    const pending = promptInput('frame 0\nChoose [A/b] ', {
      animation: { intervalMs: 20, render: (seconds) => `frame ${seconds > 0 ? 1 : 0}\nChoose [A/b] ` },
    });
    await vi.advanceTimersByTimeAsync(45);

    expect(openSyncMock).not.toHaveBeenCalled();
    expect(rl.setPrompt).toHaveBeenCalledWith('frame 1\nChoose [A/b] ');
    expect(rl.prompt).toHaveBeenCalledWith(true);
    expect(rl.line).toBe('partially typed');

    (stdoutRef.value as NodeJS.WriteStream & { columns: number }).columns = 80;
    await vi.advanceTimersByTimeAsync(50);
    expect(rl.prompt).toHaveBeenCalledTimes(1);
    answer('accepted');
    await expect(pending).resolves.toBe('accepted');
    await vi.advanceTimersByTimeAsync(50);
    expect(rl.prompt).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('stops animation and rejects as cancellation when readline closes before an answer', async () => {
    vi.useFakeTimers();
    stdinRef.value = Object.assign(new EventEmitter(), { isTTY: true }) as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: true, columns: 92, rows: 24 } as unknown as NodeJS.WriteStream;
    const rl = Object.assign(new EventEmitter(), {
      question: vi.fn(),
      setPrompt: vi.fn(),
      prompt: vi.fn(),
      getCursorPos: vi.fn(() => ({ cols: 0, rows: 3 })),
      close: vi.fn(),
    });
    createInterfaceMock.mockReturnValue(rl);
    const { promptInput } = await import('./promptInput');
    const pending = promptInput('frame 0\nChoose [A/b] ', {
      animation: { intervalMs: 40, render: () => 'frame 1\nChoose [A/b] ' },
    });
    await vi.advanceTimersByTimeAsync(45);
    rl.emit('close');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    expect(rl.prompt).toHaveBeenCalledTimes(1);
  });

  it('adapts arrow and Escape keypresses through the same readline prompt lifecycle', async () => {
    const input = Object.assign(new EventEmitter(), { isTTY: true, label: 'stdin' });
    stdinRef.value = input as unknown as NodeJS.ReadStream;
    stdoutRef.value = { isTTY: true, columns: 92, rows: 24 } as unknown as NodeJS.WriteStream;
    const onMove = vi.fn();
    const onToggle = vi.fn();
    const rl = Object.assign(new EventEmitter(), {
      question: vi.fn(),
      setPrompt: vi.fn(),
      prompt: vi.fn(),
      getCursorPos: vi.fn(() => ({ cols: 0, rows: 3 })),
      write: vi.fn(),
      close: vi.fn(),
    });
    createInterfaceMock.mockReturnValue(rl);
    const { promptInput } = await import('./promptInput');
    const render = vi.fn(() => 'moved menu\nChoose ');
    const pending = promptInput('menu\nChoose ', {
      animation: {
        animate: false,
        render,
        onMove,
        onToggle,
        answerOnEmpty: () => 'b',
      },
    });
    input.emit('keypress', '', { name: 'down' });
    expect(onMove).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledWith(0);
    expect(rl.setPrompt).toHaveBeenCalledWith('moved menu\nChoose ');
    input.emit('keypress', ' ', { name: 'space' });
    expect(onToggle).toHaveBeenCalledOnce();
    expect(rl.write).toHaveBeenCalledWith(null, { ctrl: true, name: 'u' });
    (stdoutRef.value as NodeJS.WriteStream & { columns: number }).columns = 80;
    input.emit('keypress', '', { name: 'up' });
    expect(onMove).toHaveBeenCalledTimes(1);
    input.emit('keypress', '', { name: 'escape' });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(input.listenerCount('keypress')).toBe(0);
  });

  it('opens /dev/tty on POSIX interactive terminals and closes readline streams and file handle', async () => {
    platformRef.value = 'linux';
    existsSyncMock.mockReturnValue(true);
    const input = new PassThrough();
    const output = new PassThrough();
    openSyncMock.mockReturnValueOnce(40).mockReturnValueOnce(41);
    ttyReadStreamMock.mockReturnValue(input);
    ttyWriteStreamMock.mockReturnValue(output);
    const rl = createPromptRl('typed value');
    createInterfaceMock.mockReturnValue(rl);
    const inputDestroy = vi.spyOn(input, 'destroy');
    const outputDestroy = vi.spyOn(output, 'destroy');
    const outputEnd = vi.spyOn(output, 'end');

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ')).resolves.toBe('typed value');

    expect(openSyncMock).toHaveBeenNthCalledWith(1, '/dev/tty', 'r+');
    expect(openSyncMock).toHaveBeenNthCalledWith(2, '/dev/tty', 'r+');
    expect(ttyReadStreamMock).toHaveBeenCalledWith(40);
    expect(ttyWriteStreamMock).toHaveBeenCalledWith(41);
    expect(createInterfaceMock).toHaveBeenCalledWith({ input, output, terminal: true });
    expect(rl.close).toHaveBeenCalledTimes(1);
    expect(outputEnd).toHaveBeenCalledTimes(1);
    expect(outputEnd.mock.invocationCallOrder[0]).toBeLessThan(outputDestroy.mock.invocationCallOrder[0] ?? 0);
    expect(inputDestroy).toHaveBeenCalledTimes(1);
    expect(outputDestroy).toHaveBeenCalledTimes(1);
  });

  it('falls back to process stdio when /dev/tty cannot be opened', async () => {
    platformRef.value = 'linux';
    existsSyncMock.mockReturnValue(true);
    openSyncMock.mockImplementation(() => {
      throw new Error('no tty');
    });
    const rl = createPromptRl('fallback value');
    createInterfaceMock.mockReturnValue(rl);

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ')).resolves.toBe('fallback value');

    expect(createInterfaceMock).toHaveBeenCalledWith({
      input: stdinRef.value,
      output: stdoutRef.value,
    });
    expect(rl.close).toHaveBeenCalledTimes(1);
  });

  it('suppresses readline echo for secret process-stdio prompts', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    const writeSpy = vi.fn();
    stdoutRef.value = { isTTY: true, label: 'stdout-tty', write: writeSpy } as unknown as NodeJS.WriteStream;
    const rl = Object.assign(new EventEmitter(), {
      question: vi.fn((prompt: string, resolve: (value: string) => void) => {
        expect(prompt).toBe('');
        resolve('secret value');
      }),
      close: vi.fn(),
      _writeToOutput: vi.fn(),
    });
    createInterfaceMock.mockReturnValue(rl);

    const { promptSecretInput } = await import('./promptInput');
    await expect(promptSecretInput('Secret: ')).resolves.toBe('secret value');

    expect(writeSpy).toHaveBeenNthCalledWith(1, 'Secret: ');
    expect(writeSpy).toHaveBeenNthCalledWith(2, '\n');
    expect(rl._writeToOutput).not.toHaveBeenCalled();
    expect(rl.close).toHaveBeenCalledTimes(1);
  });

  it('does not attempt /dev/tty on Windows', async () => {
    platformRef.value = 'win32';
    existsSyncMock.mockReturnValue(true);
    const rl = createPromptRl('windows value');
    createInterfaceMock.mockReturnValue(rl);

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ')).resolves.toBe('windows value');

    expect(openSyncMock).not.toHaveBeenCalled();
    expect(createInterfaceMock).toHaveBeenCalledWith({
      input: stdinRef.value,
      output: stdoutRef.value,
    });
  });

  it('closes readline and rejects when an active prompt is aborted', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    const controller = new AbortController();
    const rl = Object.assign(new EventEmitter(), {
      question: vi.fn((_prompt: string, resolve: (value: string) => void) => {
        controller.abort();
        resolve('late answer');
      }),
      close: vi.fn(),
    });
    createInterfaceMock.mockReturnValue(rl);

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(rl.close).toHaveBeenCalledTimes(1);
  });

  it('releases an aborted prompt before a following prompt can accept a late answer', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    const controller = new AbortController();
    let firstAnswer: ((value: string) => void) | undefined;
    let secondAnswer: ((value: string) => void) | undefined;
    const firstRl = new EventEmitter() as EventEmitter & {
      question: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    firstRl.question = vi.fn((_prompt: string, resolve: (value: string) => void) => {
      firstAnswer = resolve;
    });
    firstRl.close = vi.fn();
    const secondRl = new EventEmitter() as EventEmitter & {
      question: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    secondRl.question = vi.fn((_prompt: string, resolve: (value: string) => void) => {
      secondAnswer = resolve;
    });
    secondRl.close = vi.fn();
    createInterfaceMock.mockReturnValueOnce(firstRl).mockReturnValueOnce(secondRl);

    const { promptInput } = await import('./promptInput');
    const first = promptInput('First: ', { signal: controller.signal });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = promptInput('Second: ');
    if (!firstAnswer || !secondAnswer) throw new Error('Expected both readline callbacks');

    firstAnswer('late answer');
    await Promise.resolve();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    secondAnswer('second answer');
    await expect(second).resolves.toBe('second answer');
    expect(firstRl.close).toHaveBeenCalledTimes(1);
    expect(secondRl.close).toHaveBeenCalledTimes(1);
  });

  it('treats readline SIGINT as one aborted process-stdio prompt and ignores a late answer', async () => {
    stdinRef.value = { isTTY: false, label: 'stdin-pipe' } as unknown as NodeJS.ReadStream;
    let answer!: (value: string) => void;
    const rl = new EventEmitter() as EventEmitter & {
      question: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    rl.question = vi.fn((_prompt: string, resolve: (value: string) => void) => {
      answer = resolve;
      rl.emit('SIGINT');
    });
    rl.close = vi.fn();
    createInterfaceMock.mockReturnValue(rl);

    const { promptInput } = await import('./promptInput');
    const pending = promptInput('Prompt: ');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    answer('late answer');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    expect(rl.close).toHaveBeenCalledTimes(1);
    expect(rl.listenerCount('SIGINT')).toBe(0);
  });

  it('treats readline SIGINT as one aborted /dev/tty prompt and closes every owned resource', async () => {
    platformRef.value = 'linux';
    existsSyncMock.mockReturnValue(true);
    const input = new PassThrough();
    const output = new PassThrough();
    openSyncMock.mockReturnValueOnce(40).mockReturnValueOnce(41);
    ttyReadStreamMock.mockReturnValue(input);
    ttyWriteStreamMock.mockReturnValue(output);
    let answer!: (value: string) => void;
    const rl = new EventEmitter() as EventEmitter & {
      question: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    rl.question = vi.fn((_prompt: string, resolve: (value: string) => void) => {
      answer = resolve;
      rl.emit('SIGINT');
    });
    rl.close = vi.fn();
    createInterfaceMock.mockReturnValue(rl);
    const inputDestroy = vi.spyOn(input, 'destroy');
    const outputDestroy = vi.spyOn(output, 'destroy');
    const outputEnd = vi.spyOn(output, 'end');

    const { promptInput } = await import('./promptInput');
    const pending = promptInput('Prompt: ');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    answer('late answer');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    expect(rl.close).toHaveBeenCalledTimes(1);
    expect(rl.listenerCount('SIGINT')).toBe(0);
    expect(inputDestroy).toHaveBeenCalledTimes(1);
    expect(inputDestroy.mock.invocationCallOrder[0]).toBeLessThan(outputEnd.mock.invocationCallOrder[0] ?? 0);
    expect(outputDestroy).toHaveBeenCalledTimes(1);
  });

  it('closes /dev/tty resources when readline question throws', async () => {
    platformRef.value = 'linux';
    existsSyncMock.mockReturnValue(true);
    const input = new PassThrough();
    const output = new PassThrough();
    openSyncMock.mockReturnValueOnce(40).mockReturnValueOnce(41);
    ttyReadStreamMock.mockReturnValue(input);
    ttyWriteStreamMock.mockReturnValue(output);
    const rl = new EventEmitter() as EventEmitter & {
      question: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    rl.question = vi.fn(() => {
      throw new Error('question failed');
    });
    rl.close = vi.fn();
    createInterfaceMock.mockReturnValue(rl);
    const inputDestroy = vi.spyOn(input, 'destroy');
    const outputDestroy = vi.spyOn(output, 'destroy');

    const { promptInput } = await import('./promptInput');
    await expect(promptInput('Prompt: ')).rejects.toThrow('question failed');

    expect(rl.close).toHaveBeenCalledTimes(1);
    expect(inputDestroy).toHaveBeenCalledTimes(1);
    expect(outputDestroy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveInteractiveTerminal', () => {
    it('is interactive when stdin and stdout are both TTYs', async () => {
        const { resolveInteractiveTerminal } = await import('./promptInput');
        const hasControllingTty = vi.fn(() => false);

        expect(resolveInteractiveTerminal({
            stdinIsTty: true,
            stdoutIsTty: true,
            platform: 'darwin',
            hasControllingTty,
        })).toBe(true);

        // The cheap check answers it; no need to probe the device.
        expect(hasControllingTty).not.toHaveBeenCalled();
    });

    it('is interactive when stdin is a spent pipe but a controlling terminal is attached', async () => {
        const { resolveInteractiveTerminal } = await import('./promptInput');
        // This is the `curl -fsSL … | bash -s -- --run <cmd>` case: the installer
        // hands the CLI an exhausted pipe on stdin, but the user is still sitting
        // at a terminal. `promptInput` already prompts through a freshly-opened
        // /dev/tty here, so refusing to prompt at all is the bug.
        expect(resolveInteractiveTerminal({
            stdinIsTty: false,
            stdoutIsTty: true,
            platform: 'linux',
            hasControllingTty: () => true,
        })).toBe(true);
    });

    it('is interactive when stdout is redirected but a controlling terminal is attached', async () => {
        const { resolveInteractiveTerminal } = await import('./promptInput');
        expect(resolveInteractiveTerminal({
            stdinIsTty: true,
            stdoutIsTty: false,
            platform: 'darwin',
            hasControllingTty: () => true,
        })).toBe(true);
    });

    it('is not interactive when there is no TTY and no controlling terminal', async () => {
        const { resolveInteractiveTerminal } = await import('./promptInput');
        // CI: /dev/tty may exist as a device node but cannot be opened.
        expect(resolveInteractiveTerminal({
            stdinIsTty: false,
            stdoutIsTty: false,
            platform: 'linux',
            hasControllingTty: () => false,
        })).toBe(false);
    });

    it('does not probe for a controlling terminal on Windows', async () => {
        const { resolveInteractiveTerminal } = await import('./promptInput');
        const hasControllingTty = vi.fn(() => true);

        expect(resolveInteractiveTerminal({
            stdinIsTty: false,
            stdoutIsTty: true,
            platform: 'win32',
            hasControllingTty,
        })).toBe(false);
        expect(hasControllingTty).not.toHaveBeenCalled();
    });
});
