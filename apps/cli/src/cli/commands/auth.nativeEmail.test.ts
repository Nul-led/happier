import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { Readable } from 'node:stream';
import tweetnacl from 'tweetnacl';
import {
  createKeyChallengeV2SigningInput,
  decodeBase64,
  formatRecoveryKey,
} from '@happier-dev/protocol';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';
import { captureConsoleText } from '@/testkit/logger/captureOutput';

const authenticatedHome = vi.hoisted(() => ({
  register: vi.fn(async () => ({ machineId: 'machine-1' })),
}));

vi.mock('@/ui/auth', () => ({
  registerMachineWithAuthenticatedHomeRuntime: authenticatedHome.register,
}));

describe('native email and recovery CLI commands', () => {
  const env = createEnvKeyScope([
    'HAPPIER_HOME_DIR',
    'HAPPIER_SERVER_URL',
    'HAPPIER_PUBLIC_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_TOKEN',
  ]);
  let home = '';

  beforeEach(async () => {
    home = await createTempDir('happier-native-email-command-');
    env.patch({
      HAPPIER_HOME_DIR: home,
      HAPPIER_SERVER_URL: 'http://account.test',
      HAPPIER_PUBLIC_SERVER_URL: 'http://account.test',
      HAPPIER_WEBAPP_URL: 'http://account.test',
      HAPPIER_TOKEN: undefined,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      features: {},
      capabilities: { serverIdentity: { serverIdentityId: 'srv_home' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    authenticatedHome.register.mockClear();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    env.restore();
    process.exitCode = 0;
    await removeTempDir(home);
  });

  it('preserves the exact Plain password supplied through stdin', async () => {
    const app = fastify();
    const password = '  exact password with surrounding spaces  ';
    app.post('/v1/auth/email/prelogin', async () => ({ v: 1, kind: 'plain_password' }));
    app.post('/v1/auth/email/login', async (request) => {
      expect(request.body).toEqual({ v: 1, email: 'person@example.test', password });
      return { token: 'header.eyJzdWIiOiJhY2NvdW50LTEifQ.signature' };
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { expandAuthSecretsFromStdin } = await import('./auth/stdinSecrets');
      const args = await expandAuthSecretsFromStdin(
        ['login', '--email', 'person@example.test', '--json', '--secrets-json-stdin'],
        Readable.from([JSON.stringify({ v: 1, secrets: { password } })]),
      );
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand(args);
      const envelope = JSON.parse(output.text());
      expect(envelope).toMatchObject({ ok: true, data: { accountId: 'account-1' } });
      expect(output.text()).not.toContain(password);
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });

  it('binds recovery-key authentication to an existing Account in both request and signature', async () => {
    const app = fastify();
    const recoverySecret = new Uint8Array(32).fill(7);
    const recoveryKey = formatRecoveryKey(recoverySecret);
    const challenge = {
      challengeId: 'challenge-existing-account',
      nonce: 'nonce-existing-account',
      issuedAt: '2026-09-10T10:00:00.000Z',
      expiresAt: '2026-09-10T18:00:00.000Z',
      audience: { origin: 'http://account.test', serverIdentityId: 'srv_home' },
    } as const;
    app.post('/v1/auth/challenge', async () => challenge);
    app.post('/v1/auth', async (request) => {
      expect(request.body).toMatchObject({
        challengeId: 'challenge-existing-account',
        requireExistingAccount: true,
      });
      const body = request.body as { publicKey: string; signature: string };
      expect(tweetnacl.sign.detached.verify(
        createKeyChallengeV2SigningInput({ ...challenge, requireExistingAccount: true }),
        decodeBase64(body.signature),
        decodeBase64(body.publicKey),
      )).toBe(true);
      return { token: 'header.eyJzdWIiOiJhY2NvdW50LTEifQ.signature' };
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand(['recovery-key', 'login', '--key', recoveryKey, '--json']);
      const envelope = JSON.parse(output.text());
      expect(envelope).toMatchObject({ ok: true, data: { accountId: 'account-1' } });
      expect(output.text()).not.toContain(recoveryKey);
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });

  it('keeps reset requests existence-neutral and dispatches them through the selected Home', async () => {
    const app = fastify();
    app.post('/v1/auth/password/reset/request', async (request) => {
      expect(request.body).toEqual({ v: 1, email: 'person@example.test' });
      return { accepted: true };
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand(['email', 'reset-request', '--email', 'Person@Example.Test', '--json']);
      expect(JSON.parse(output.text())).toEqual({
        v: 1,
        ok: true,
        kind: 'auth_password_reset_request',
        data: { accepted: true },
      });
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });

  it('requests invitation-scoped mailbox proof before transferable invitation provisioning', async () => {
    const app = fastify();
    const invitationToken = 'I'.repeat(43);
    let provisionRequests = 0;
    app.post('/v1/auth/email/verify/request', async (request) => {
      expect(request.body).toEqual({
        v: 1,
        email: 'person@example.test',
        admission: { kind: 'team_invitation', token: invitationToken },
      });
      return { accepted: true };
    });
    app.post('/v1/auth/email/provision', async () => {
      provisionRequests += 1;
      return {};
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand([
        'email', 'provision',
        '--email', 'person@example.test',
        '--invitation-token', invitationToken,
        '--json',
      ]);

      expect(JSON.parse(output.text())).toMatchObject({
        ok: true,
        kind: 'auth_email_provision',
        data: { verificationRequested: true },
      });
      expect(provisionRequests).toBe(0);
      expect(output.text()).not.toContain(invitationToken);
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });

  it('preserves reset password bytes from stdin and projects the canonical typed failure', async () => {
    const app = fastify();
    const password = '  replacement password bytes  ';
    const resetToken = 'R'.repeat(43);
    app.post('/v1/auth/password/reset/submit', async (request, reply) => {
      expect(request.body).toEqual({ v: 1, token: resetToken, password });
      return reply.code(400).send({ error: 'invalid_reset' });
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { expandAuthSecretsFromStdin } = await import('./auth/stdinSecrets');
      const args = await expandAuthSecretsFromStdin(
        ['email', 'reset-submit', '--json', '--secrets-json-stdin'],
        Readable.from([JSON.stringify({ v: 1, secrets: { resetToken, newPassword: password } })]),
      );
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand(args);
      const envelope = JSON.parse(output.text());
      expect(envelope).toMatchObject({ ok: false, kind: 'auth_password_reset_submit', error: { code: 'invalid_reset' } });
      expect(output.text()).not.toContain(password);
      expect(output.text()).not.toContain(resetToken);
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });

  it('completes sign-in email changes with the stored interactive credential and typed errors', async () => {
    const app = fastify();
    const verificationToken = 'V'.repeat(43);
    app.post('/v1/account/email/change', async (request, reply) => {
      expect(request.headers.authorization).toBe('Bearer interactive');
      expect(request.body).toEqual({ v: 1, verificationToken });
      return reply.code(400).send({ error: 'verification_invalid' });
    });
    const restore = installAxiosFastifyAdapter({ app, origin: 'http://account.test' });
    const output = captureConsoleText();
    try {
      const { writeCredentialsTokenOnly } = await import('@/persistence');
      await writeCredentialsTokenOnly({ token: 'interactive' });
      const { expandAuthSecretsFromStdin } = await import('./auth/stdinSecrets');
      const args = await expandAuthSecretsFromStdin(
        ['email', 'change-complete', '--json', '--secrets-json-stdin'],
        Readable.from([JSON.stringify({ v: 1, secrets: { verificationToken } })]),
      );
      const { handleAuthCommand } = await import('./auth');
      await handleAuthCommand(args);
      const envelope = JSON.parse(output.text());
      expect(envelope).toMatchObject({ ok: false, kind: 'auth_email_change_complete', error: { code: 'verification_invalid' } });
      expect(output.text()).not.toContain(verificationToken);
    } finally {
      output.restore();
      restore();
      await app.close();
    }
  });
});
