import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  runNativeConfinedWorkspaceSyncDelete,
  runNativeConfinedWorkspaceSyncRead,
  type WorkspaceSyncNativeConfinedChild,
} from './workspaceSyncNativeConfinedFileSystem';

class FakeChild extends EventEmitter implements WorkspaceSyncNativeConfinedChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function createHarness(result: Readonly<Record<string, unknown>>) {
  const child = new FakeChild();
  const writes: unknown[] = [];
  let buffered = '';
  child.stdin.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    while (buffered.includes('\n')) {
      const newline = buffered.indexOf('\n');
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const parsed = JSON.parse(line) as unknown;
      writes.push(parsed);
      if (writes.length === 1) {
        child.stdout.write(`${JSON.stringify({ v: 1, t: 'workspace-confined-prepared' })}\n`);
      } else if ((parsed as { decision?: unknown }).decision === 'commit') {
        child.stdout.write(`${JSON.stringify(result)}\n`);
        child.stdout.end();
        child.stderr.end();
        queueMicrotask(() => child.emit('close', 0, null));
      }
    }
  });
  return {
    child,
    writes,
    dependencies: {
      platform: 'win32' as const,
      resolveExecutable: () => 'C:\\happier-process-custody.exe',
      spawnChild: vi.fn(() => child),
    },
  };
}

describe('workspaceSyncNativeConfinedFileSystem', () => {
  it.runIf(process.env.HAPPIER_RUN_NATIVE_CONFINED_WORKSPACE_SYNC_REAL_INTEGRATION === '1')(
    'uses the staged native helper for read, abort preservation, and committed deletion',
    async () => {
      expect(['darwin', 'win32']).toContain(process.platform);
      const rootPath = await mkdtemp(join(tmpdir(), 'happier-workspace-confinement-'));
      const relativePath = 'loser.txt';
      const filePath = join(rootPath, relativePath);
      const content = Buffer.from('native workspace confinement');
      const authorityError = Object.assign(new Error('root authority changed'), {
        code: 'workspace_root_changed',
      });

      try {
        await writeFile(filePath, content);
        const preview = await runNativeConfinedWorkspaceSyncRead({
          rootPath,
          relativePath,
          maxBytes: 1024,
        });
        expect(preview).toMatchObject({
          status: 'content',
          size: content.byteLength,
        });
        if (preview.status !== 'content') {
          throw new Error(`expected native content preview, received ${preview.status}`);
        }
        expect(preview.content).toEqual(content);

        await expect(runNativeConfinedWorkspaceSyncDelete({
          rootPath,
          relativePath,
          expectedKind: 'file',
          expectedDigest: preview.digest,
          assertCurrentAuthority: async () => { throw authorityError; },
        })).rejects.toBe(authorityError);
        await expect(readFile(filePath)).resolves.toEqual(content);

        await expect(runNativeConfinedWorkspaceSyncDelete({
          rootPath,
          relativePath,
          expectedKind: 'file',
          expectedDigest: preview.digest,
        })).resolves.toBeUndefined();
        await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    },
  );

  it('holds native handles while the canonical authority is checked before preview disclosure', async () => {
    const harness = createHarness({
      v: 1,
      t: 'workspace-confined-result',
      status: 'content',
      size: 5,
      digest: 'a'.repeat(40),
      contentBase64: Buffer.from('hello').toString('base64'),
    });
    let releaseAuthority!: () => void;
    const authority = new Promise<void>((resolve) => { releaseAuthority = resolve; });
    const assertCurrentAuthority = vi.fn(async () => await authority);

    const result = runNativeConfinedWorkspaceSyncRead({
      rootPath: 'C:\\work',
      relativePath: 'src\\index.ts',
      maxBytes: 1024,
      assertCurrentAuthority,
    }, harness.dependencies);

    await vi.waitFor(() => expect(harness.writes).toHaveLength(1));
    expect(harness.writes[0]).toMatchObject({
      v: 1,
      rootPath: 'C:\\work',
      relativePath: 'src\\index.ts',
      maxBytes: 1024,
    });
    releaseAuthority();
    await expect(result).resolves.toEqual({
      status: 'content',
      size: 5,
      digest: 'a'.repeat(40),
      content: Buffer.from('hello'),
    });
    expect(assertCurrentAuthority).toHaveBeenCalledTimes(1);
    expect(harness.writes[1]).toEqual({ v: 1, decision: 'commit' });
  });

  it('accepts an empty regular-file preview from the native helper', async () => {
    const harness = createHarness({
      v: 1,
      t: 'workspace-confined-result',
      status: 'content',
      size: 0,
      digest: 'a'.repeat(40),
      contentBase64: '',
    });

    await expect(runNativeConfinedWorkspaceSyncRead({
      rootPath: 'C:\\work',
      relativePath: 'empty.txt',
      maxBytes: 1024,
    }, harness.dependencies)).resolves.toEqual({
      status: 'content',
      size: 0,
      digest: 'a'.repeat(40),
      content: Buffer.alloc(0),
    });
  });

  it('aborts without commit when current authority rejects', async () => {
    const harness = createHarness({ v: 1, t: 'workspace-confined-result', status: 'deleted' });
    const authorityError = Object.assign(new Error('root changed'), { code: 'workspace_root_changed' });

    await expect(runNativeConfinedWorkspaceSyncDelete({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: 'b'.repeat(40),
      assertCurrentAuthority: async () => { throw authorityError; },
    }, harness.dependencies)).rejects.toBe(authorityError);

    expect(harness.writes).toEqual([
      expect.objectContaining({ v: 1, expectedKind: 'file' }),
      { v: 1, decision: 'abort' },
    ]);
    expect(harness.writes).not.toContainEqual({ v: 1, decision: 'commit' });
    expect(harness.child.kill).toHaveBeenCalledTimes(1);
  });

  it('resolves a successful delete after the native helper commits', async () => {
    const harness = createHarness({ v: 1, t: 'workspace-confined-result', status: 'deleted' });

    await expect(runNativeConfinedWorkspaceSyncDelete({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: 'b'.repeat(40),
    }, harness.dependencies)).resolves.toBeUndefined();

    expect(harness.writes[1]).toEqual({ v: 1, decision: 'commit' });
  });

  it('fails closed when the packaged native helper is unavailable', async () => {
    await expect(runNativeConfinedWorkspaceSyncRead({
      rootPath: 'C:\\work',
      relativePath: 'preview.txt',
      maxBytes: 1024,
    }, {
      platform: 'win32',
      resolveExecutable: () => null,
      spawnChild: vi.fn(),
    })).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
  });

  it('rejects malformed or padded native results instead of interpreting them', async () => {
    const harness = createHarness({
      v: 1,
      t: 'workspace-confined-result',
      status: 'content',
      size: 5,
      digest: 'a'.repeat(40),
      contentBase64: Buffer.from('hello').toString('base64'),
      extra: true,
    });

    await expect(runNativeConfinedWorkspaceSyncRead({
      rootPath: 'C:\\work',
      relativePath: 'preview.txt',
      maxBytes: 1024,
    }, harness.dependencies)).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
  });

  it('preserves a typed precondition rejection produced before prepare', async () => {
    const child = new FakeChild();
    child.stdin.on('data', () => {
      child.stdout.write(`${JSON.stringify({
        v: 1,
        t: 'workspace-confined-result',
        status: 'error',
        code: 'conflict_changed',
        message: 'conflict loser digest changed',
      })}\n`);
      child.stdout.end();
      child.stderr.end();
      queueMicrotask(() => child.emit('close', 0, null));
    });

    await expect(runNativeConfinedWorkspaceSyncDelete({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: 'b'.repeat(40),
    }, {
      platform: 'win32',
      resolveExecutable: () => 'C:\\happier-process-custody.exe',
      spawnChild: () => child,
    })).rejects.toMatchObject({
      code: 'conflict_changed',
      message: 'conflict loser digest changed',
    });
  });

  it('decodes native records when a Unicode path is split across stream chunks', async () => {
    const child = new FakeChild();
    let writes = 0;
    child.stdin.on('data', (chunk: Buffer) => {
      const records = chunk.toString('utf8').trim().split('\n');
      for (const record of records) {
        if (!record) continue;
        writes += 1;
        if (writes === 1) {
          child.stdout.write(`${JSON.stringify({ v: 1, t: 'workspace-confined-prepared' })}\n`);
          continue;
        }
        const encoded = Buffer.from(`${JSON.stringify({
          v: 1,
          t: 'workspace-confined-result',
          status: 'error',
          code: 'conflict_changed',
          message: 'recovery remains at café',
          recoveryPath: 'C:\\work\\café',
        })}\n`);
        const split = encoded.indexOf(Buffer.from('é')) + 1;
        child.stdout.write(encoded.subarray(0, split));
        queueMicrotask(() => {
          child.stdout.write(encoded.subarray(split));
          child.stdout.end();
          child.stderr.end();
          queueMicrotask(() => child.emit('close', 0, null));
        });
      }
    });

    await expect(runNativeConfinedWorkspaceSyncDelete({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: 'b'.repeat(40),
    }, {
      platform: 'win32',
      resolveExecutable: () => 'C:\\happier-process-custody.exe',
      spawnChild: () => child,
    })).rejects.toMatchObject({
      code: 'conflict_changed',
      message: 'recovery remains at café',
      recoveryPath: 'C:\\work\\café',
    });
  });

  it('terminates a helper that exceeds the bounded preview transport', async () => {
    const child = new FakeChild();
    child.stdin.on('data', () => {
      child.stdout.write(Buffer.alloc(2 * 1024 * 1024, 65));
    });

    await expect(runNativeConfinedWorkspaceSyncRead({
      rootPath: 'C:\\work',
      relativePath: 'preview.txt',
      maxBytes: 1024,
    }, {
      platform: 'win32',
      resolveExecutable: () => 'C:\\happier-process-custody.exe',
      spawnChild: () => child,
    })).rejects.toMatchObject({
      code: 'workspace_root_unsafe',
      message: 'native workspace confinement exceeded its output bound',
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
