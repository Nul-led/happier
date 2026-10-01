import {
  withWorkspaceBundleLock,
  type WorkspaceBundleLockContext,
  type WorkspaceBundleLockOptions,
} from '../../../../../packages/cli-common/workspaceBundleLock.mjs';

/** One publisher; preparation supplies its currentness check at the commit boundary. */
export async function withPreparedGeneratorPublication<T>(input: Readonly<{
  prepare: () => Promise<() => void>;
  publish: (lease: WorkspaceBundleLockContext) => Promise<T>;
  lockOptions: WorkspaceBundleLockOptions<T>;
}>): Promise<T> {
  const assertCurrent = await input.prepare();
  return await withWorkspaceBundleLock(async (lease) => {
    lease.assertOwned();
    assertCurrent();
    return await input.publish({
      ...lease,
      assertOwned: () => {
        lease.assertOwned();
        assertCurrent();
      },
    });
  }, input.lockOptions);
}
