import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentCliRuntimeSpec, getAgentCliSetupRecommendedIds } from '@happier-dev/agents';

import { reloadConfiguration } from '@/configuration';
import { writeDaemonState } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';
import { handleAgentsCommand } from './agents';

describe('happier agents daemon install jobs', () => {
  let home = '';
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);
  let requests: Array<{ path: string; body: Record<string, unknown>; token: string }>;
  let outcome: Record<string, unknown>;

  beforeEach(async () => {
    home = await createTempDir('happier-agents-install-jobs-');
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);
    envScope.patch({ HAPPIER_HOME_DIR: home, PATH: join(home, 'bin') });
    reloadConfiguration();
    writeDaemonState({ pid: process.pid, httpPort: 49151, startedAt: Date.now(), startedWithCliVersion: 'test', controlToken: 'local-job-token' });
    requests = [];
    outcome = { kind: 'succeeded', version: '1.2.3' };
    // The authenticated HTTP transport is the system boundary. All command,
    // catalog, consent, cursor, and output logic underneath it remains real.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'http://127.0.0.1:49151') throw new Error('External downloads are forbidden in this fixture');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ path: url.pathname, body, token: new Headers(init?.headers).get('x-happier-daemon-token') ?? '' });
      const response = url.pathname.endsWith('/start')
        ? { ok: true, jobId: 'install-job-1' }
        : { ok: true, events: [], steps: [], progress: [], nextCursor: 0, done: true, outcome };
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    envScope.restore();
    reloadConfiguration();
    await removeTempDir(home);
  });

  it.each(['install', 'update'])('executes %s through the authenticated daemon and preserves the job outcome', async (intent) => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand([intent, 'codex', '--json']);
      const envelope = JSON.parse(output.logs.join('\n').trim());
      expect(envelope).toMatchObject({ ok: true, kind: `agents_${intent}`, data: { agentId: 'codex', jobId: 'install-job-1', version: '1.2.3' } });
      expect(requests).toEqual([
        { path: '/agents/install/start', body: { agentId: 'codex', intent, consent: { vendorRecipe: false } }, token: 'local-job-token' },
        { path: '/agents/install/read', body: { jobId: 'install-job-1', cursor: 0 }, token: 'local-job-token' },
      ]);
    } finally { output.restore(); }
  });

  it('does not grant vendor recipe consent implicitly and retains the typed failure', async () => {
    outcome = { kind: 'failed', code: 'consent_required', stepId: 'cli.claude', message: 'Vendor consent required' };
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['install', 'claude', '--json']);
      const envelope = JSON.parse(output.logs.join('\n').trim());
      expect(envelope).toMatchObject({ ok: false, error: { code: 'consent_required' } });
      expect(requests[0]?.body).toMatchObject({ consent: { vendorRecipe: false } });
    } finally { output.restore(); }
  });

  it.each(['install', 'update'])('reports the observed terminal version without claiming %s ran when adopting a shared job', async (intent) => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand([intent, 'codex']);
      const message = output.logs.join('\n');
      expect(message).toContain('1.2.3');
      expect(message).not.toMatch(/\b(?:installed|updated)\b/i);
    } finally { output.restore(); }
  });

  it('forwards explicit vendor consent and force to the daemon owner', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['install', 'claude', '--yes', '--force', '--json']);
      expect(JSON.parse(output.logs.join('\n').trim()).ok).toBe(true);
      expect(requests[0]?.body).toEqual({ agentId: 'claude', intent: 'install', consent: { vendorRecipe: true }, force: true });
    } finally { output.restore(); }
  });

  it('keeps dry-run planning local without sending a job or granting consent', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['install', 'claude', '--dry-run', '--json']);
      const envelope = JSON.parse(output.logs.join('\n').trim());
      expect(envelope).toMatchObject({ ok: true, data: { plan: { agentId: 'claude', installMode: 'vendor_recipe' } } });
      expect(requests).toEqual([]);
    } finally { output.restore(); }
  });

  it('reads the next event cursor until the daemon settles the job', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path, body, token: new Headers(init?.headers).get('x-happier-daemon-token') ?? '' });
      if (path.endsWith('/start')) return new Response(JSON.stringify({ ok: true, jobId: 'install-job-1' }));
      return new Response(JSON.stringify(body.cursor === 0
        ? { ok: true, events: [{ t: 'step', stepId: 'cli.codex', label: 'Codex', state: 'running' }], steps: [{ stepId: 'cli.codex', label: 'Codex', state: 'running' }], progress: [], nextCursor: 1, done: false, outcome: null }
        : { ok: true, events: [], steps: [{ stepId: 'cli.codex', label: 'Codex', state: 'done' }], progress: [], nextCursor: 1, done: true, outcome }));
    });
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['install', 'codex', '--json']);
      expect(JSON.parse(output.logs.join('\n').trim()).ok).toBe(true);
      expect(requests.filter((request) => request.path.endsWith('/read')).map((request) => request.body.cursor)).toEqual([0, 1]);
    } finally { output.restore(); }
  });

  it('cancels the daemon job on an interrupt and removes its signal listeners', async () => {
    const initialListenerCount = process.listenerCount('SIGINT');
    let cancelled = false;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path, body, token: new Headers(init?.headers).get('x-happier-daemon-token') ?? '' });
      if (path.endsWith('/start')) return new Response(JSON.stringify({ ok: true, jobId: 'install-job-1' }));
      if (path.endsWith('/cancel')) {
        cancelled = true;
        return new Response(JSON.stringify({ ok: true }));
      }
      if (cancelled) return new Response(JSON.stringify({ ok: true, events: [], steps: [{ stepId: 'cli.codex', label: 'Codex', state: 'failed' }], progress: [], nextCursor: 0, done: true, outcome: { kind: 'failed', code: 'cancelled', stepId: 'cli.codex', message: 'Cancelled' } }));
      process.emit('SIGINT');
      return new Response(JSON.stringify({ ok: true, events: [], steps: [], progress: [], nextCursor: 0, done: false, outcome: null }));
    });
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['install', 'codex', '--json']);
      expect(JSON.parse(output.logs.join('\n').trim())).toMatchObject({ ok: false, error: { code: 'cancelled' } });
      expect(requests.filter((request) => request.path.endsWith('/cancel'))).toEqual([{ path: '/agents/install/cancel', body: { jobId: 'install-job-1' }, token: 'local-job-token' }]);
      expect(process.listenerCount('SIGINT')).toBe(initialListenerCount);
    } finally { output.restore(); }
  });

  it('shares the daemon execution path with setup and verifies executable readiness afterward', async () => {
    const fetch = globalThis.fetch;
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown>, token: new Headers(init?.headers).get('x-happier-daemon-token') ?? '' });
      await mkdir(join(home, 'bin'), { recursive: true });
      await writeFile(join(home, 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      return new Response(JSON.stringify({ ok: true, jobId: 'install-job-1' }));
    });
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--providers', 'codex', '--json']);
      const envelope = JSON.parse(output.logs.join('\n').trim());
      expect(envelope).toMatchObject({ ok: true, data: { agents: [{ agentId: 'codex', ok: true, installed: true, jobId: 'install-job-1' }] } });
      expect(requests[0]?.path).toBe('/agents/install/start');
    } finally { output.restore(); }
  });

  it('selects only the missing recommended agents under setup --yes', async () => {
    const alreadyInstalled = getAgentCliSetupRecommendedIds()[0];
    if (!alreadyInstalled) throw new Error('The setup fixture requires one recommended agent');
    const binaryName = getAgentCliRuntimeSpec(alreadyInstalled).binaryName;
    await mkdir(join(home, 'bin'), { recursive: true });
    await writeFile(join(home, 'bin', process.platform === 'win32' ? `${binaryName}.cmd` : binaryName), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const statusOutput = captureConsoleLogAndMuteStdout();
    let expectedAgentIds: string[];
    try {
      await handleAgentsCommand(['status', '--json']);
      const status = JSON.parse(statusOutput.logs.join('\n').trim()) as { data: { agents: Array<{ id: string; installed: boolean }> } };
      const installed = new Set(status.data.agents.filter((agent) => agent.installed).map((agent) => agent.id));
      expect(installed.has(alreadyInstalled)).toBe(true);
      expectedAgentIds = getAgentCliSetupRecommendedIds().filter((agentId) => !installed.has(agentId));
    } finally { statusOutput.restore(); }
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--yes', '--json']);
      // These transport responses deliberately do not materialize executables;
      // setup may fail readiness, but must still select exactly the missing set.
      expect(requests.filter((request) => request.path.endsWith('/start')).map((request) => request.body.agentId)).toEqual(expectedAgentIds);
    } finally { output.restore(); }
  });

  it('retains the typed setup refusal for an unsupported selection without starting jobs', async () => {
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand(['setup', '--providers', 'unknown-fixture-agent', '--json']);
      expect(JSON.parse(output.logs.join('\n').trim())).toMatchObject({ ok: false, kind: 'agents_setup', error: { code: 'unsupported_agent', agentIds: ['unknown-fixture-agent'] } });
      expect(requests).toEqual([]);
    } finally { output.restore(); }
  });
});
