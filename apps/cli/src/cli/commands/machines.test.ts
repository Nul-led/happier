import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const credentialBoundary = vi.hoisted(() => ({ readStoredCredentials: vi.fn() }));
vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: credentialBoundary.readStoredCredentials,
}));

const executorBoundary = vi.hoisted(() => ({ execute: vi.fn(), create: vi.fn() }));
vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials: (params: unknown) => {
    executorBoundary.create(params);
    return { execute: executorBoundary.execute };
  },
}));

import { handleMachinesCommand } from './machines';
import { findCompiledActionCliCommand, listCompiledActionCliCommands } from '@/cli/actions/compiledCommands';
import { runCompiledActionCliCommand } from '@/cli/actions/executeCommand';

function machinesListCommand() {
  const command = findCompiledActionCliCommand(['machines', 'list'], listCompiledActionCliCommands());
  if (!command) throw new Error('machines.list declares no friendly command');
  return command;
}

async function runMachinesList(rest: readonly string[]): Promise<void> {
  await runCompiledActionCliCommand({
    command: machinesListCommand(),
    argv: ['machines', 'list', ...rest],
  });
}

beforeEach(() => {
  executorBoundary.execute.mockReset();
  executorBoundary.create.mockReset();
  credentialBoundary.readStoredCredentials.mockReset();
});

afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });

describe('machines list through the canonical Action', () => {
  it('shows the compiled help without reading credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runMachinesList(['--help']);

    expect(credentialBoundary.readStoredCredentials).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('happier machines list');
    expect(process.exitCode).toBeUndefined();
  });

  it('invokes machines.list with the friendly page bound and preserves the released output', async () => {
    credentialBoundary.readStoredCredentials.mockResolvedValue({
      token: 'pat', encryption: null, credentialProvenance: 'api_token',
    });
    executorBoundary.execute.mockResolvedValue({
      ok: true,
      result: { items: [{ id: 'machine-1', active: true, revokedAt: null, replacedByMachineId: null }] },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runMachinesList([]);

    expect(credentialBoundary.readStoredCredentials).toHaveBeenCalledOnce();
    expect(executorBoundary.create).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.objectContaining({ credentialProvenance: 'api_token' }) }),
    );
    expect(executorBoundary.execute).toHaveBeenCalledWith(
      'machines.list',
      { limit: 200 },
      expect.objectContaining({ surface: 'cli' }),
    );
    expect(log.mock.calls.flat().join('\n')).toContain('machine-1');
  });

  it('keeps the released machines_list JSON envelope', async () => {
    credentialBoundary.readStoredCredentials.mockResolvedValue({ token: 'token', encryption: null });
    executorBoundary.execute.mockResolvedValue({
      ok: true,
      result: { items: [{ id: 'machine-1', active: false, revokedAt: null, replacedByMachineId: 'machine-2' }] },
    });
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
      output += String(chunk);
      const callback = args.find((value) => typeof value === 'function') as (() => void) | undefined;
      callback?.();
      return true;
    }) as never);

    await runMachinesList(['--json']);

    expect(JSON.parse(output)).toMatchObject({
      v: 1,
      ok: true,
      kind: 'machines_list',
      data: { machines: [{ id: 'machine-1', active: false, replacedByMachineId: 'machine-2' }] },
    });
  });

  it('rejects an unknown option before reading credentials', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
      output += String(chunk);
      const callback = args.find((value) => typeof value === 'function') as (() => void) | undefined;
      callback?.();
      return true;
    }) as never);

    await runMachinesList(['--bogus', '--json']);

    expect(JSON.parse(output)).toMatchObject({
      v: 1, ok: false, kind: 'machines_list', error: { code: 'invalid_arguments' },
    });
    expect(credentialBoundary.readStoredCredentials).not.toHaveBeenCalled();
    expect(executorBoundary.execute).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('classifies an unexpected inventory exception as exit 2', async () => {
    credentialBoundary.readStoredCredentials.mockResolvedValue({ token: 'token', encryption: null });
    executorBoundary.execute.mockRejectedValue(new Error('dependency exploded'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runMachinesList([]);

    expect(process.exitCode).toBe(2);
  });
});

describe('machines root command', () => {
  it('shows help with no subcommand, listing every compiled leaf under this root', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await handleMachinesCommand([]);
    const help = log.mock.calls.flat().join('\n');
    expect(help).toContain('happier machines list');
    // Machine Pool administration is compiled from the Action catalog; family
    // help must document what dispatch and completion already accept.
    for (const verb of ['create', 'get', 'list', 'update', 'delete', 'resolve']) {
      expect(help).toContain(`happier machines pools ${verb}`);
    }
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an unknown subcommand as a stable JSON envelope', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
      output += String(chunk);
      const callback = args.find((value) => typeof value === 'function') as (() => void) | undefined;
      callback?.();
      return true;
    }) as never);
    await handleMachinesCommand(['bogus', '--json']);
    expect(JSON.parse(output)).toMatchObject({
      v: 1, ok: false, kind: 'machines_list', error: { code: 'unknown_subcommand' },
    });
    expect(process.exitCode).toBe(1);
  });
});
