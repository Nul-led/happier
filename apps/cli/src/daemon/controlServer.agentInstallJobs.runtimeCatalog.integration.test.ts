import { describe, expect, it } from 'vitest';

import { createDaemonControlApp } from './controlServer';

function createApp() {
  return createDaemonControlApp({
    getChildren: () => [],
    machineId: 'machine-install-jobs',
    stopSession: async () => ({ status: 'not_found' as const }),
    spawnSession: async () => ({ type: 'success' as const, sessionId: 'unused' }),
    requestShutdown: () => {},
    onHappySessionWebhook: () => {},
    controlToken: 'install-job-control-token',
  });
}

describe('daemon local agent install jobs', () => {
  it('requires the private daemon control token on every job operation', async () => {
    const app = createApp();
    try {
      for (const operation of ['start', 'read', 'cancel', 'list']) {
        const response = await app.inject({ method: 'POST', url: `/agents/install/${operation}`, payload: {} });
        expect(response.statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it('rejects malformed starts and lists without creating a job', async () => {
    const app = createApp();
    const headers = { 'x-happier-daemon-token': 'install-job-control-token' };
    try {
      const invalid = await app.inject({
        method: 'POST', url: '/agents/install/start', headers,
        payload: { agentId: 'codex', intent: 'install', consent: { vendorRecipe: 'yes' } },
      });
      expect(invalid.statusCode).toBe(400);
      const listed = await app.inject({ method: 'POST', url: '/agents/install/list', headers, payload: {} });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({ ok: true, jobs: [] });
      const unknownField = await app.inject({ method: 'POST', url: '/agents/install/list', headers, payload: { unsafe: true } });
      expect(unknownField.statusCode).toBe(400);
      const missingRead = await app.inject({ method: 'POST', url: '/agents/install/read', headers, payload: { jobId: 'missing-job', cursor: 0 } });
      expect(missingRead.statusCode).toBe(200);
      expect(missingRead.json()).toMatchObject({ ok: false, errorCode: 'job_not_found' });
      const missingCancel = await app.inject({ method: 'POST', url: '/agents/install/cancel', headers, payload: { jobId: 'missing-job' } });
      expect(missingCancel.statusCode).toBe(200);
      expect(missingCancel.json()).toMatchObject({ ok: false, errorCode: 'job_not_found' });
    } finally {
      await app.close();
    }
  });
});
