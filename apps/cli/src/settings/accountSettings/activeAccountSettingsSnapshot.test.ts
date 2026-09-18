import { accountSettingsParse } from '@happier-dev/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as activeAccountSettingsSnapshot from './activeAccountSettingsSnapshot';

import {
    clearActiveAccountSettingsSnapshot,
    commitActiveAccountSettingsSnapshot,
    getActiveAccountSettingsSnapshot,
    getActiveAccountSettingsSnapshotLifetimeToken,
    resolveActiveAccountSettingsSnapshotRevision,
    resolveActiveSavedSecretCatalogCollisionState,
  resetActiveAccountSettingsSnapshotForTests,
    setActiveAccountSettingsSnapshot,
    subscribeActiveAccountSettingsSnapshot,
} from './activeAccountSettingsSnapshot';

function snapshot(params: Readonly<{
  scopeKey: string;
  version: number;
  timing: 'after_foreground_ready' | 'after_runtime_idle';
}>) {
  return {
    source: 'network' as const,
    settings: accountSettingsParse({ sessionPendingQueueDeliveryTiming: params.timing }),
    settingsVersion: params.version,
    loadedAtMs: params.version,
    settingsSecretsReadKeys: [],
    scopeKey: params.scopeKey,
  };
}

const configuredExternalSessionSourceRevisions = activeAccountSettingsSnapshot as typeof activeAccountSettingsSnapshot & Readonly<{
  notifyActiveAccountConnectedServicesProjection(scopeKey: string): void;
  resolveActiveAccountConfiguredExternalSessionSourceRevision(
    snapshot: activeAccountSettingsSnapshot.ActiveAccountSettingsSnapshot | null,
  ): string;
}>;

describe('active account settings snapshot publication', () => {
  beforeEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
  });

  it('projects collision state from the authoritative Account snapshot without mutating it', () => {
    const next = {
      ...snapshot({ scopeKey: 'scope-a', version: 1, timing: 'after_runtime_idle' }),
      settings: accountSettingsParse({
        secrets: [{
          id: 'happier:shared-secret:v1:legacy-personal',
          name: 'Legacy',
          kind: 'token',
          encryptedValue: { _isSecretValue: true, value: 'exact-value' },
          createdAt: 1,
          updatedAt: 7,
        }],
      }),
    };
    setActiveAccountSettingsSnapshot(next);

    const active = getActiveAccountSettingsSnapshot();
    if (!active) throw new Error('expected active snapshot');
    expect(active).toBe(next);
    expect(resolveActiveSavedSecretCatalogCollisionState(active)).toEqual({
      status: 'migration_required',
      collisions: [{
        ref: 'happier:shared-secret:v1:legacy-personal',
        expectedUpdatedAt: 7,
      }],
    });
  });

  it('keeps the same-scope accepted winner for equal and older commits without notifying', () => {
    const winner = snapshot({ scopeKey: 'scope-a', version: 4, timing: 'after_runtime_idle' });
    setActiveAccountSettingsSnapshot(winner);
    const listener = vi.fn();
    const unsubscribe = subscribeActiveAccountSettingsSnapshot(listener);

    const equal = commitActiveAccountSettingsSnapshot(
      snapshot({ scopeKey: 'scope-a', version: 4, timing: 'after_foreground_ready' }),
    );
    const older = commitActiveAccountSettingsSnapshot(
      snapshot({ scopeKey: 'scope-a', version: 3, timing: 'after_foreground_ready' }),
    );

    expect(equal).toEqual({ snapshot: winner, didCommit: false });
    expect(older).toEqual({ snapshot: winner, didCommit: false });
    expect(getActiveAccountSettingsSnapshot()).toBe(winner);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('allows a different credential scope to become the active winner', () => {
    const previous = snapshot({ scopeKey: 'scope-a', version: 9, timing: 'after_runtime_idle' });
    const next = snapshot({ scopeKey: 'scope-b', version: 1, timing: 'after_foreground_ready' });
    setActiveAccountSettingsSnapshot(previous);
    const listener = vi.fn();
    const unsubscribe = subscribeActiveAccountSettingsSnapshot(listener);

    expect(commitActiveAccountSettingsSnapshot(next)).toEqual({ snapshot: next, didCommit: true });
    expect(getActiveAccountSettingsSnapshot()).toBe(next);
    expect(listener).toHaveBeenCalledWith(previous, next);
    unsubscribe();
  });

  it('preserves the independent Saved Secret catalog across a newer same-Account Settings publication', () => {
    const resourceDataKey = new Uint8Array(32).fill(23);
    const previous = {
      ...snapshot({ scopeKey: 'scope-a', version: 4, timing: 'after_runtime_idle' }),
      savedSecretCatalogState: 'ready' as const,
      savedSecretResources: [{
        resourceId: 'resource-e2ee',
        ownerAccountId: 'owner-account',
        displayName: 'Shared API key',
        kind: 'apiKey' as const,
        encryptionMode: 'e2ee' as const,
        revision: 7,
        storedContent: { t: 'encrypted' as const, c: 'AA==' },
        materialStatus: 'ready' as const,
        resourceDataKey,
      }],
    };
    setActiveAccountSettingsSnapshot(previous);

    const committed = commitActiveAccountSettingsSnapshot(
      snapshot({ scopeKey: 'scope-a', version: 5, timing: 'after_foreground_ready' }),
    );

    expect(committed.snapshot.savedSecretCatalogState).toBe('ready');
    expect(committed.snapshot.savedSecretResources).toBe(previous.savedSecretResources);
    expect([...resourceDataKey]).toEqual(new Array(32).fill(23));
  });

    it('keeps a committed winner when a subscriber throws', () => {
        const next = snapshot({ scopeKey: 'scope-a', version: 1, timing: 'after_runtime_idle' });
        const unsubscribe = subscribeActiveAccountSettingsSnapshot(() => {
      throw new Error('consumer wake failed');
    });

    expect(commitActiveAccountSettingsSnapshot(next)).toEqual({ snapshot: next, didCommit: true });
        expect(getActiveAccountSettingsSnapshot()).toBe(next);
        unsubscribe();
    });

    it('publishes the null transition when logout clears the active Account snapshot', () => {
        const previous = snapshot({ scopeKey: 'scope-a', version: 1, timing: 'after_runtime_idle' });
        setActiveAccountSettingsSnapshot(previous);
        const listener = vi.fn();
        const unsubscribe = subscribeActiveAccountSettingsSnapshot(listener);

        clearActiveAccountSettingsSnapshot();

        expect(getActiveAccountSettingsSnapshot()).toBeNull();
        expect(listener).toHaveBeenCalledWith(previous, null);
        unsubscribe();
    });

    it('zeroes opened Saved Secret resource DEKs when the Account lifetime is revoked', () => {
        const resourceDataKey = new Uint8Array(32).fill(23);
        setActiveAccountSettingsSnapshot({
            ...snapshot({ scopeKey: 'scope-a', version: 1, timing: 'after_runtime_idle' }),
            savedSecretCatalogState: 'ready',
            savedSecretResources: [{
                resourceId: 'resource-e2ee',
                ownerAccountId: 'owner-account',
                displayName: 'Shared API key',
                kind: 'apiKey',
                encryptionMode: 'e2ee',
                revision: 1,
                storedContent: { t: 'encrypted', c: 'AA==' },
                materialStatus: 'ready',
                resourceDataKey,
            }],
        });

        clearActiveAccountSettingsSnapshot();

        expect([...resourceDataKey]).toEqual(new Array(32).fill(0));
    });

    it('advances the incumbent lifetime only when an Account enters, changes, or is revoked', () => {
        const before = getActiveAccountSettingsSnapshotLifetimeToken();

        setActiveAccountSettingsSnapshot(
            snapshot({ scopeKey: 'scope-a', version: 4, timing: 'after_runtime_idle' }),
        );
        const accountA = getActiveAccountSettingsSnapshotLifetimeToken();

        setActiveAccountSettingsSnapshot(
            snapshot({ scopeKey: 'scope-a', version: 5, timing: 'after_foreground_ready' }),
        );
        const accountARevision = getActiveAccountSettingsSnapshotLifetimeToken();

        setActiveAccountSettingsSnapshot(
            snapshot({ scopeKey: 'scope-b', version: 1, timing: 'after_foreground_ready' }),
        );
        const accountB = getActiveAccountSettingsSnapshotLifetimeToken();

        setActiveAccountSettingsSnapshot(
            snapshot({ scopeKey: 'scope-a', version: 2, timing: 'after_runtime_idle' }),
        );
        const accountAAgain = getActiveAccountSettingsSnapshotLifetimeToken();

        clearActiveAccountSettingsSnapshot();
        const cleared = getActiveAccountSettingsSnapshotLifetimeToken();

        clearActiveAccountSettingsSnapshot();
        const clearedAgain = getActiveAccountSettingsSnapshotLifetimeToken();

        setActiveAccountSettingsSnapshot(
            snapshot({ scopeKey: 'scope-a', version: 6, timing: 'after_runtime_idle' }),
        );
        const accountAReentered = getActiveAccountSettingsSnapshotLifetimeToken();

        expect(accountA).toBeGreaterThan(before);
        expect(accountARevision).toBe(accountA);
        expect(accountB).toBeGreaterThan(accountA);
        expect(accountAAgain).toBeGreaterThan(accountB);
        expect(cleared).toBeGreaterThan(accountAAgain);
        expect(clearedAgain).toBe(cleared);
        expect(accountAReentered).toBeGreaterThan(cleared);
    });

  it('publishes a Connected Services-only projection through the active source revision without changing Settings revision', () => {
    const active = snapshot({ scopeKey: 'scope-a', version: 4, timing: 'after_runtime_idle' });
    setActiveAccountSettingsSnapshot(active);
    const sourceRevisionBefore =
      configuredExternalSessionSourceRevisions
        .resolveActiveAccountConfiguredExternalSessionSourceRevision(active);
    const settingsRevisionBefore = resolveActiveAccountSettingsSnapshotRevision(active);
    const listener = vi.fn();
    const unsubscribe = subscribeActiveAccountSettingsSnapshot(listener);

    configuredExternalSessionSourceRevisions
      .notifyActiveAccountConnectedServicesProjection('scope-a');

    expect(getActiveAccountSettingsSnapshot()).toBe(active);
    expect(resolveActiveAccountSettingsSnapshotRevision(active)).toBe(settingsRevisionBefore);
    expect(
      configuredExternalSessionSourceRevisions
        .resolveActiveAccountConfiguredExternalSessionSourceRevision(active),
    ).not.toBe(sourceRevisionBefore);
    expect(listener).toHaveBeenCalledWith(active, active);

    configuredExternalSessionSourceRevisions
      .notifyActiveAccountConnectedServicesProjection('scope-b');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
