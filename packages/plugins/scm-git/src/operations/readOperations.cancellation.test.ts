import { describe, expect, it, vi } from 'vitest';

const { runScmCommandMock } = vi.hoisted(() => ({
  runScmCommandMock: vi.fn(),
}));

vi.mock('../runtime.js', () => ({
  runScmCommand: runScmCommandMock,
  normalizeCommitRef: (rawCommit: string) => ({ ok: true, commit: rawCommit }),
  normalizeRepoRootRelativePath: (path: string) => ({ ok: true, relativePath: path, pathspec: path }),
}));

import { gitLogList } from './readOperations.js';

describe('gitLogList cancellation', () => {
  it('shares one AbortSignal across every concurrent commit-query arm and waits for all to terminate', async () => {
    const controller = new AbortController();
    const terminated: number[] = [];
    runScmCommandMock.mockImplementation((input: Readonly<{ signal?: AbortSignal }>) => new Promise((resolve) => {
      const callIndex = runScmCommandMock.mock.calls.length;
      const settle = () => {
        terminated.push(callIndex);
        resolve({ success: false, stdout: '', stderr: 'SCM command was aborted', exitCode: -1 });
      };
      if (input.signal?.aborted) settle();
      else if (input.signal) input.signal.addEventListener('abort', settle, { once: true });
      else setTimeout(settle, 50);
    }));

    const result = gitLogList({
      context: { cwd: '/repo', projectKey: 'test:/repo', detection: { isRepo: true, rootPath: '/repo', mode: '.git' } },
      request: { cwd: '/repo', query: 'deadbeef', limit: 10 },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(runScmCommandMock).toHaveBeenCalledTimes(3));
    controller.abort();
    await result;

    expect(runScmCommandMock.mock.calls.map(([input]) => input.signal)).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
    expect(terminated).toHaveLength(3);
  });
});
