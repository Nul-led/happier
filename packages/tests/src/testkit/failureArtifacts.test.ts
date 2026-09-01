import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearRegisteredRuntimeSecretValues, REDACTED_SECRET_PLACEHOLDER, registerRuntimeSecretValues } from './artifactSecretSafety';
import { FailureArtifacts } from './failureArtifacts';

describe('FailureArtifacts secret safety', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'happier-failure-artifacts-'));
    clearRegisteredRuntimeSecretValues();
  });

  afterEach(() => {
    clearRegisteredRuntimeSecretValues();
  });

  it('rejects credential-shaped json artifacts without persisting their content', async () => {
    const artifacts = new FailureArtifacts();
    artifacts.json('credentials.json', async () => ({
      credentials: { apiKey: 'sentinel-api-key-0123456789abcdef' },
    }));
    artifacts.json('safe.json', async () => ({ users: 25 }));

    await artifacts.dumpAll(testDir);

    const rejected = readFileSync(join(testDir, 'credentials.json'), 'utf8');
    expect(rejected).not.toContain('sentinel-api-key-0123456789abcdef');
    expect(rejected).toContain('REJECTED_CREDENTIAL_SHAPED_ARTIFACT');
    expect(rejected).toContain('credentials.apiKey');
    expect(JSON.parse(readFileSync(join(testDir, 'safe.json'), 'utf8'))).toEqual({ users: 25 });
  });

  it('scrubs registered runtime secret values from json and text artifacts', async () => {
    const masterSecret = 'sentinel-master-secret-0123456789abcdef';
    registerRuntimeSecretValues(masterSecret);
    const artifacts = new FailureArtifacts();
    artifacts.json('events.json', async () => ({ note: `bootstrap used ${masterSecret}` }));
    artifacts.text('server.log', async () => `startup ok\nHANDY_MASTER_SECRET=${masterSecret}\n`);

    await artifacts.dumpAll(testDir);

    expect(readFileSync(join(testDir, 'events.json'), 'utf8')).toContain(REDACTED_SECRET_PLACEHOLDER);
    const log = readFileSync(join(testDir, 'server.log'), 'utf8');
    expect(log).not.toContain(masterSecret);
    expect(log).toContain('HANDY_MASTER_SECRET=[REDACTED]');
  });

  it('redacts unregistered credentials embedded in free-form json and text', async () => {
    const bearer = 'sentinel-unregistered-bearer-0123456789abcdef';
    const password = 'sentinel-url-password-0123456789abcdef';
    const envSecret = 'sentinel-env-secret-0123456789abcdef';
    const artifacts = new FailureArtifacts();
    artifacts.json('events.json', async () => ({
      output: `Authorization: Bearer ${bearer}`,
      url: `https://operator:${password}@example.test/path`,
    }));
    artifacts.text('server.log', async () => `HAPPIER_HOME_MASTER_SECRET=${envSecret}\n`);

    await artifacts.dumpAll(testDir);

    const json = readFileSync(join(testDir, 'events.json'), 'utf8');
    const text = readFileSync(join(testDir, 'server.log'), 'utf8');
    expect(json).not.toContain(bearer);
    expect(json).not.toContain(password);
    expect(text).not.toContain(envSecret);
  });

  it('records producer errors without leaking registered runtime secrets', async () => {
    const secret = 'sentinel-producer-error-secret-0123456789abcdef';
    registerRuntimeSecretValues(secret);
    const artifacts = new FailureArtifacts();
    artifacts.json('broken.json', async () => {
      throw new Error(`collector unavailable for ${secret}`);
    });

    await artifacts.dumpAll(testDir);

    const written = readFileSync(join(testDir, 'broken.json'), 'utf8');
    expect(written).toContain('FAILED_TO_WRITE_ARTIFACT');
    expect(written).toContain('collector unavailable');
    expect(written).not.toContain(secret);
    expect(written).toContain(REDACTED_SECRET_PLACEHOLDER);
  });

  it('respects onlyIf=false by writing nothing', async () => {
    const artifacts = new FailureArtifacts();
    artifacts.text('skip.txt', async () => 'unused');

    await artifacts.dumpAll(testDir, { onlyIf: false });

    expect(existsSync(join(testDir, 'skip.txt'))).toBe(false);
  });
});
