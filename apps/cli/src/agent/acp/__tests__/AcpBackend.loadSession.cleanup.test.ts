import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AcpBackend } from '../AcpBackend';
import { writeAcpTestAgentScript } from '../testkit/subprocessHarness';
import { withTempDir } from '@/testkit/fs/tempDir';

const CALL_LOG_FILE_NAME = 'acp-calls.log';

/**
 * `negotiateLoadSession` mirrors the only fact the host's resume policy reads
 * from a real Agent: what `initialize` advertised on this exact connection. The
 * cleanup cases must advertise it, or they stop at the negotiation refusal and
 * never reach the upstream `session/load` failure they exist to cover.
 */
function writeFakeAcpAgentScript(params: Readonly<{
  dir: string;
  negotiateLoadSession: boolean;
}>): string {
  const src = `
    import { appendFileSync } from 'node:fs';
    import { join } from 'node:path';
    const decoder = new TextDecoder();
    let buf = '';
    let loadCount = 0;
    let newSessionCount = 0;
    const callLogPath = join(${JSON.stringify(params.dir)}, ${JSON.stringify(CALL_LOG_FILE_NAME)});

    function send(obj) {
      process.stdout.write(JSON.stringify(obj) + '\\n');
    }

    function ok(id, result) {
      send({ jsonrpc: '2.0', id, result });
    }

    function err(id, message, details) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message, data: { details } } });
    }

    process.stdin.on('data', (chunk) => {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let req;
        try {
          req = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!req || typeof req !== 'object') continue;

        const id = req.id;
        const method = req.method;
        const params = req.params;
        if (id === undefined || id === null || typeof method !== 'string') continue;
        appendFileSync(callLogPath, method + '\\n');

        if (method === 'initialize') {
          ok(id, {
            protocolVersion: 1,
            authMethods: [],
            agentCapabilities: { loadSession: ${params.negotiateLoadSession ? 'true' : 'false'} },
          });
          continue;
        }

        if (method === 'session/load') {
          loadCount += 1;
          if (loadCount <= 3) {
            err(id, 'Internal error', 'No previous sessions found for this project.');
            continue;
          }
          ok(id, { sessionId: params?.sessionId ?? 'loaded-session' });
          continue;
        }

        if (method === 'session/new') {
          newSessionCount += 1;
          err(id, 'Internal error', 'Unable to create an ACP session. attempt=' + newSessionCount);
          continue;
        }

        ok(id, {});
      }
    });
  `;

  return writeAcpTestAgentScript({
    dir: params.dir,
    fileName: 'fake-acp-agent.mjs',
    source: src,
  });
}

function readCalledMethods(dir: string): readonly string[] {
  try {
    return readFileSync(join(dir, CALL_LOG_FILE_NAME), 'utf8')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe('AcpBackend loadSession cleanup on failure', () => {
  it('allows a second loadSession attempt after an upstream load failure without staying initialized', async () => {
    await withTempDir('happier-acp-load-cleanup-', async (dir) => {
      const scriptPath = writeFakeAcpAgentScript({ dir, negotiateLoadSession: true });
      let backend: AcpBackend | null = null;

      try {
        backend = new AcpBackend({
          agentName: 'test',
          cwd: dir,
          command: process.execPath,
          args: [scriptPath],
        });

        await expect(backend.loadSession('resume-1')).rejects.toThrow(/No previous sessions found for this project/);
        await expect(backend.loadSession('resume-1')).rejects.toThrow(/No previous sessions found for this project/);
      } finally {
        try {
          await backend?.dispose();
        } catch {}
      }
    });
  }, 20_000);

  it('allows a second startSession attempt after an upstream new-session failure without staying initialized', async () => {
    await withTempDir('happier-acp-new-cleanup-', async (dir) => {
      const scriptPath = writeFakeAcpAgentScript({ dir, negotiateLoadSession: true });
      let backend: AcpBackend | null = null;

      try {
        backend = new AcpBackend({
          agentName: 'test',
          cwd: dir,
          command: process.execPath,
          args: [scriptPath],
        });

        await expect(backend.startSession()).rejects.toThrow(/Unable to create an ACP session\. attempt=1/);
        await expect(backend.startSession()).rejects.toThrow(/Unable to create an ACP session\. attempt=1/);
      } finally {
        try {
          await backend?.dispose();
        } catch {}
      }
    });
  }, 20_000);

  it('issues exactly one session/load per resume attempt and never falls back to session/new', async () => {
    await withTempDir('happier-acp-load-one-shot-', async (dir) => {
      const scriptPath = writeFakeAcpAgentScript({ dir, negotiateLoadSession: true });
      let backend: AcpBackend | null = null;

      try {
        backend = new AcpBackend({
          agentName: 'test',
          cwd: dir,
          command: process.execPath,
          args: [scriptPath],
        });

        await expect(backend.loadSession('resume-1')).rejects.toThrow(/No previous sessions found for this project/);

        const methods = readCalledMethods(dir);
        // `session/load` mutates provider state, so a failure is ambiguous: the
        // connection is torn down and the caller decides, rather than the
        // transport quietly replaying the load.
        expect(methods.filter((method) => method === 'session/load')).toHaveLength(1);
        expect(methods).not.toContain('session/new');
      } finally {
        try {
          await backend?.dispose();
        } catch {}
      }
    });
  }, 20_000);

  it('fails before session/load when the connection never negotiated it, and never falls back to session/new', async () => {
    await withTempDir('happier-acp-load-negotiation-', async (dir) => {
      const scriptPath = writeFakeAcpAgentScript({ dir, negotiateLoadSession: false });
      let backend: AcpBackend | null = null;

      try {
        backend = new AcpBackend({
          agentName: 'test',
          cwd: dir,
          command: process.execPath,
          args: [scriptPath],
        });

        await expect(backend.loadSession('resume-1'))
          .rejects.toThrow(/did not negotiate ACP session\/load support during initialize/);

        const methods = readCalledMethods(dir);
        expect(methods).toContain('initialize');
        expect(methods).not.toContain('session/load');
        // A refused resume must surface, never silently become a fresh session.
        expect(methods).not.toContain('session/new');
      } finally {
        try {
          await backend?.dispose();
        } catch {}
      }
    });
  }, 20_000);
});
