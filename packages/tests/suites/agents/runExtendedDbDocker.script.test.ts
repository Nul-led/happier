import { describe, expect, it } from 'vitest';

import * as runExtendedDbDockerScript from '../../scripts/run-extended-db-docker.mjs';
import { parseArgs, resolveExtendedDbCommandTimeoutMs, resolveExtendedDbStepTimeoutMs } from '../../scripts/run-extended-db-docker.mjs';
import { buildExtendedDbCommandPlan } from '../../scripts/extended-db-docker.plan.mjs';

type YarnInvocationResolver = (
  args: readonly string[],
  options?: Readonly<{ platform?: NodeJS.Platform; npmExecPath?: string; comspec?: string }>,
) => Readonly<{ command: string; args: string[]; windowsVerbatimArguments?: boolean }>;

describe('extended-db docker script args', () => {
  it('parses valid args', () => {
    const parsed = parseArgs([
      'node',
      'run-extended-db-docker.mjs',
      '--db',
      'postgres',
      '--mode',
      'contract',
      '--name',
      'db-test',
      '--keep',
    ]);

    expect(parsed).toEqual({
      mode: 'contract',
      keep: true,
      db: 'postgres',
      name: 'db-test',
    });
  });

  it('accepts the explicit Session System Record upgrade contract mode', () => {
    expect(parseArgs([
      'node',
      'run-extended-db-docker.mjs',
      '--db',
      'mysql',
      '--mode',
      'session-system-record-upgrade',
    ])).toEqual({
      mode: 'session-system-record-upgrade',
      keep: false,
      db: 'mysql',
    });
  });

  it('rejects unknown args', () => {
    expect(() => parseArgs(['node', 'run-extended-db-docker.mjs', '--db', 'postgres', '--invalid'])).toThrow(
      /Unknown arg/,
    );
  });

  it('wraps the Windows Yarn shim through cmd.exe', () => {
    const resolveExtendedDbYarnInvocation = (runExtendedDbDockerScript as {
      resolveExtendedDbYarnInvocation?: YarnInvocationResolver;
    }).resolveExtendedDbYarnInvocation;

    expect(resolveExtendedDbYarnInvocation).toBeTypeOf('function');
    if (!resolveExtendedDbYarnInvocation) throw new Error('missing extended DB Yarn invocation resolver');

    const invocation = resolveExtendedDbYarnInvocation(['-s', 'test:e2e:core:fast'], {
      platform: 'win32',
      npmExecPath: 'C:\\npm\\node_modules\\npm\\bin\\npm-cli.js',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.windowsVerbatimArguments).toBe(true);
    expect(invocation.args.join(' ')).toContain('corepack.cmd');
    expect(invocation.args.join(' ')).toContain('yarn');
    expect(invocation.args.join(' ')).not.toContain('npm-cli.js');
  });
});

describe('Session System Record provider upgrade command plan', () => {
  const databaseUrl = 'provider://fixture-url';

  it.each([
    ['postgres', 'migrate:full:deploy', 'HAPPIER_TEST_POSTGRES_DATABASE_URL'],
    ['mysql', 'migrate:mysql:deploy', 'HAPPIER_TEST_MYSQL_DATABASE_URL'],
  ] as const)('seeds %s preview data, deploys twice through the canonical owner, verifies, then runs Board contracts', (
    db,
    migrationScript,
    providerUrlKey,
  ) => {
    const plan = buildExtendedDbCommandPlan({
      db,
      mode: 'session-system-record-upgrade',
      databaseUrl,
    });

    expect(plan.map((step) => step.kind)).toEqual([
      'session-system-record-upgrade-seed',
      'session-system-record-migrate-first',
      'session-system-record-migrate-second',
      'session-system-record-upgrade-verify',
      'session-system-record-board-contract',
    ]);
    expect(plan[0]?.args).toEqual([
      '-s',
      'workspace',
      '@happier-dev/server',
      'test:session-system-record-upgrade-fixture',
      'seed',
    ]);
    for (const migrationStep of plan.slice(1, 3)) {
      expect(migrationStep.args).toEqual([
        '-s',
        'workspace',
        '@happier-dev/server',
        migrationScript,
      ]);
    }
    expect(plan[3]?.args).toEqual([
      '-s',
      'workspace',
      '@happier-dev/server',
      'test:session-system-record-upgrade-fixture',
      'verify',
    ]);
    expect(plan[4]?.args).toEqual([
      'workspace',
      '@happier-dev/server',
      'test:db-contract',
      'sources/app/session/systemRecords/sessionSystemRecords.dbcontract.spec.ts',
    ]);
    for (const step of plan) {
      expect(step.env).toMatchObject({
        HAPPIER_DB_PROVIDER: db,
        DATABASE_URL: databaseUrl,
        [providerUrlKey]: databaseUrl,
      });
    }
    expect(plan.flatMap((step) => step.args).join(' ')).not.toMatch(/\bprisma\s+migrate\s+deploy\b/u);
  });

  it('uses the canonical PostgreSQL migration owner for ordinary final-schema contracts too', () => {
    const plan = buildExtendedDbCommandPlan({ db: 'postgres', mode: 'contract', databaseUrl });
    expect(plan[0]?.args).toEqual([
      '-s',
      'workspace',
      '@happier-dev/server',
      'migrate:full:deploy',
    ]);
    expect(plan.flatMap((step) => step.args).join(' ')).not.toMatch(/\bprisma\s+migrate\s+deploy\b/u);
  });
});

describe('extended-db docker script timeouts', () => {
  it('uses a generous default step timeout (overrideable by env)', () => {
    expect(resolveExtendedDbStepTimeoutMs({} as unknown as NodeJS.ProcessEnv)).toBe(3_600_000);
    expect(
      resolveExtendedDbStepTimeoutMs({ HAPPIER_E2E_EXTENDED_DB_STEP_TIMEOUT_MS: '120000' } as unknown as NodeJS.ProcessEnv),
    ).toBe(120_000);
  });

  it('uses fallback for missing/invalid values', () => {
    expect(resolveExtendedDbCommandTimeoutMs(undefined, 55_000)).toBe(55_000);
    expect(resolveExtendedDbCommandTimeoutMs('0', 55_000)).toBe(55_000);
    expect(resolveExtendedDbCommandTimeoutMs('-1', 55_000)).toBe(55_000);
    expect(resolveExtendedDbCommandTimeoutMs('abc', 55_000)).toBe(55_000);
  });

  it('parses values and clamps minimum', () => {
    expect(resolveExtendedDbCommandTimeoutMs('120000', 55_000)).toBe(120_000);
    expect(resolveExtendedDbCommandTimeoutMs('500', 55_000)).toBe(5_000);
  });
});
