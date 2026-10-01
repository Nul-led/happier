import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withWorkspaceBundleLock } from '../../../../../packages/cli-common/workspaceBundleLock.mjs';
import { createWorkspaceChildBuildEnv } from '../../../../../scripts/workspaces/workspaceChildBuildEnv.mjs';
import { publishCoherentProjectionOutputs } from './outputs.ts';
import { withPreparedGeneratorPublication } from './publication.ts';

describe('prepared bundled publication', () => {
  it.each(['caller-owned', 'generator-owned'] as const)(
    'lets the private child preparation and publication proceed after a %s parent publication',
    async (ownership) => {
      const root = mkdtempSync(join(tmpdir(), 'bundled-publication-handover-'));
      const lockPath = join(root, 'publication.lock');
      const outPath = join(root, 'projection.ts');
      // Exercise the private phase's real environment, preparation/publication
      // owner and output transaction in a fresh process, without compiling or
      // publishing the shared checkout's workspace closure.
      const childSource = `
        import { withWorkspaceBundleLock } from ${JSON.stringify(new URL('../../../../../packages/cli-common/workspaceBundleLock.mjs', import.meta.url).href)};
        import { withPreparedGeneratorPublication } from ${JSON.stringify(new URL('./publication.ts', import.meta.url).href)};
        import { publishCoherentProjectionOutputs } from ${JSON.stringify(new URL('./outputs.ts', import.meta.url).href)};
        const [root, lockPath, outPath] = process.argv.slice(1);
        const controller = new AbortController();
        const lockOptions = {
          lockPath,
          heldLockValue: process.env.HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD,
          signal: controller.signal,
          // An inherited lease must never wait on its parent. Abort on the
          // observed wait, rather than making a healthy-owner timeout policy.
          onWait: () => controller.abort(new Error('child waited on parent publication')),
        };
        let preparationInherited;
        await withPreparedGeneratorPublication({
          prepare: async () => {
            await withWorkspaceBundleLock(async (lease) => {
              lease.assertOwned();
              preparationInherited = lease.inherited;
            }, lockOptions);
            return () => {};
          },
          publish: async (lease) => {
            publishCoherentProjectionOutputs(root, [{ outPath, out: 'child-published' }], lease);
            process.stdout.write(JSON.stringify({ preparationInherited, publicationInherited: lease.inherited }));
          },
          lockOptions,
        });
      `;
      const runChild = async (env: NodeJS.ProcessEnv) => await promisify(execFile)(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', childSource, root, lockPath, outPath],
        { env },
      );
      const publishThenRunChild = async (callerLease: string | undefined) => {
        let publicationLease: string | undefined;
        await withPreparedGeneratorPublication({
          prepare: async () => () => {},
          publish: async (lease) => {
            publicationLease = lease.heldLockValue;
            publishCoherentProjectionOutputs(root, [{ outPath, out: 'parent-published' }], lease);
          },
          lockOptions: { lockPath, heldLockValue: callerLease },
        });
        expect(readFileSync(outPath, 'utf8')).toBe('parent-published');
        expect(existsSync(lockPath)).toBe(callerLease !== undefined);
        const childEnv = createWorkspaceChildBuildEnv({
          env: { ...process.env, HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD: publicationLease },
          heldLockValue: callerLease,
        });
        expect(childEnv.HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD).toBe(callerLease);
        const result = await runChild(childEnv);
        expect(JSON.parse(result.stdout)).toEqual({
          preparationInherited: callerLease !== undefined,
          publicationInherited: callerLease !== undefined,
        });
        expect(readFileSync(outPath, 'utf8')).toBe('child-published');
        expect(existsSync(`${lockPath}.priority-claim`)).toBe(false);
        expect(existsSync(lockPath)).toBe(callerLease !== undefined);
        if (callerLease) {
          // Sensitivity check: the incident's legacy marker cannot authenticate
          // reentry. The child must fail at admission and preserve published bytes.
          await expect(runChild({ ...childEnv, HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD: lockPath }))
            .rejects.toThrow('child waited on parent publication');
          expect(readFileSync(outPath, 'utf8')).toBe('child-published');
        }
      };
      try {
        if (ownership === 'caller-owned') {
          await withWorkspaceBundleLock(async (lease) => {
            await publishThenRunChild(lease.heldLockValue);
            lease.assertOwned();
          }, { lockPath });
        } else {
          await publishThenRunChild(undefined);
        }
        expect(existsSync(lockPath)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('lets another publisher finish while dependency preparation is pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bundled-publication-preparation-'));
    const lockPath = join(root, 'publication.lock');
    const outPath = join(root, 'projection.ts');
    let releasePreparation!: () => void;
    let preparationStarted!: () => void;
    const started = new Promise<void>((resolve) => { preparationStarted = resolve; });
    const release = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const publication = withPreparedGeneratorPublication({
      prepare: async () => {
        preparationStarted();
        await release;
        return () => {};
      },
      publish: async (lease) => publishCoherentProjectionOutputs(root, [{ outPath, out: 'prepared' }], lease),
      lockOptions: { lockPath },
    });
    await started;
    const contender = withWorkspaceBundleLock(async (lease) => {
      publishCoherentProjectionOutputs(root, [{ outPath, out: 'other-publisher' }], lease);
      return 'finished';
    }, { lockPath });
    try {
      expect(await Promise.race([contender, sleep(250).then(() => 'blocked')])).toBe('finished');
      expect(readFileSync(outPath, 'utf8')).toBe('other-publisher');
    } finally {
      releasePreparation();
      await Promise.all([publication, contender]);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails dependency preparation before waiting for or creating a publication claim', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bundled-publication-failure-'));
    const lockPath = join(root, 'publication.lock');
    let publication: Promise<unknown> | undefined;
    try {
      await withWorkspaceBundleLock(async () => {
        publication = withPreparedGeneratorPublication({
          prepare: async () => { throw new Error('dependency compiler failed'); },
          publish: async () => writeFileSync(join(root, 'projection.ts'), 'must-not-publish'),
          lockOptions: { lockPath },
        }).catch((error: unknown) => error instanceof Error ? error.message : String(error));
        expect(await Promise.race([publication, sleep(250).then(() => 'blocked')]))
          .toBe('dependency compiler failed');
        expect(existsSync(`${lockPath}.priority-claim`)).toBe(false);
        expect(existsSync(join(root, 'projection.ts'))).toBe(false);
      }, { lockPath });
    } finally {
      await publication;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an input changed while waiting before the coherent publication writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bundled-publication-currentness-'));
    const lockPath = join(root, 'publication.lock');
    const inputPath = join(root, 'source.txt');
    const outPath = join(root, 'projection.ts');
    writeFileSync(inputPath, 'first');
    writeFileSync(outPath, 'last-green');
    let prepared!: () => void;
    const preparation = new Promise<void>((resolve) => { prepared = resolve; });
    let publication!: Promise<unknown>;
    try {
      await withWorkspaceBundleLock(async () => {
        publication = withPreparedGeneratorPublication({
          prepare: async () => {
            const source = readFileSync(inputPath, 'utf8');
            prepared();
            return () => {
              if (readFileSync(inputPath, 'utf8') !== source) throw new Error('prepared inputs changed');
            };
          },
          publish: async (lease) => publishCoherentProjectionOutputs(root, [{ outPath, out: 'new' }], lease),
          lockOptions: { lockPath },
        }).catch((error: unknown) => error instanceof Error ? error.message : String(error));
        await Promise.race([preparation, sleep(250)]);
        writeFileSync(inputPath, 'second');
      }, { lockPath });
      expect(await publication).toBe('prepared inputs changed');
      expect(readFileSync(outPath, 'utf8')).toBe('last-green');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fences the output transaction when inputs change after admission', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bundled-publication-commit-currentness-'));
    const inputPath = join(root, 'source.txt');
    const outPath = join(root, 'projection.ts');
    writeFileSync(inputPath, 'first');
    writeFileSync(outPath, 'last-green');
    try {
      await expect(withPreparedGeneratorPublication({
        prepare: async () => {
          const source = readFileSync(inputPath, 'utf8');
          return () => {
            if (readFileSync(inputPath, 'utf8') !== source) throw new Error('prepared inputs changed');
          };
        },
        publish: async (lease) => {
          writeFileSync(inputPath, 'changed-during-staging');
          publishCoherentProjectionOutputs(root, [{ outPath, out: 'new' }], lease);
        },
        lockOptions: { lockPath: join(root, 'publication.lock') },
      })).rejects.toThrow('prepared inputs changed');
      expect(readFileSync(outPath, 'utf8')).toBe('last-green');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
