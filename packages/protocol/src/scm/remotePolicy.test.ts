import { describe, expect, it } from 'vitest';
import { admitScmRemotePolicy } from './remotePolicy.js';
import { admitScmCommitPolicy } from './capabilities.js';

describe('remote policy capability admission', () => {
  it('requires affirmative exact-backend capability bits only for advanced choices', () => {
    const admit = admitScmRemotePolicy;
    for (const capabilities of [undefined, {}, { writeRemotePolicies: false, writeRemoteForceWithLease: false }]) {
      expect(admit({}, capabilities)).toEqual({ success: true });
      expect(admit({ dirtyPolicy: 'refuse', reconcile: 'ff_only', pushMode: 'ordinary' }, capabilities)).toEqual({ success: true });
      for (const request of [{ dirtyPolicy: 'autostash' }, { dirtyPolicy: 'allow_git' }, { reconcile: 'rebase' }, { reconcile: 'merge' }, { pushMode: 'force_with_lease' }] as const) {
        expect(admit(request, capabilities)).toMatchObject({ success: false, errorCode: 'FEATURE_UNSUPPORTED', outcome: { kind: 'failed', errorCode: 'FEATURE_UNSUPPORTED' } });
      }
    }
    expect(admit({ dirtyPolicy: 'autostash', reconcile: 'rebase' }, { writeRemotePolicies: true })).toEqual({ success: true });
    expect(admit({ pushMode: 'force_with_lease' }, { writeRemotePolicies: true })).toMatchObject({ success: false });
    expect(admit({ pushMode: 'force_with_lease' }, { writeRemoteForceWithLease: true })).toEqual({ success: true });
  });

  it('refuses advanced commit modes unless the exact target advertises them', () => {
    const admit = admitScmCommitPolicy;
    for (const capabilities of [undefined, {}, { writeCommitAmend: false, writeCommitSignOff: false }]) {
      expect(admit({}, capabilities)).toEqual({ success: true });
      expect(admit({ mode: 'commit', signOff: false }, capabilities)).toEqual({ success: true });
      expect(admit({ mode: 'amend' }, capabilities)).toMatchObject({ success: false, errorCode: 'FEATURE_UNSUPPORTED' });
      expect(admit({ signOff: true }, capabilities)).toMatchObject({ success: false, errorCode: 'FEATURE_UNSUPPORTED' });
    }
    expect(admit({ mode: 'amend', signOff: true }, { writeCommitAmend: true, writeCommitSignOff: true })).toEqual({ success: true });
    expect(admit({ mode: 'amend', signOff: true }, { writeCommitAmend: true })).toMatchObject({ success: false });
  });
});
