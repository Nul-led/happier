import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { hasUsableAccountSettingsEncryptionMaterial } from './accountSettingsEncryptionMaterial';

describe('hasUsableAccountSettingsEncryptionMaterial', () => {
  it('accepts supported legacy and consistent data-key material', () => {
    const machineKey = new Uint8Array(32).fill(7);
    const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;

    expect(hasUsableAccountSettingsEncryptionMaterial({
      token: 'legacy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(3) },
    })).toBe(true);
    expect(hasUsableAccountSettingsEncryptionMaterial({
      token: 'data-key-token',
      encryption: { type: 'dataKey', machineKey, publicKey },
    })).toBe(true);
  });

  it('rejects absent, malformed, and inconsistent material', () => {
    const machineKey = new Uint8Array(32).fill(7);

    expect(hasUsableAccountSettingsEncryptionMaterial({ token: 'missing', encryption: null })).toBe(false);
    expect(hasUsableAccountSettingsEncryptionMaterial({
      token: 'short-legacy',
      encryption: { type: 'legacy', secret: new Uint8Array(16) },
    })).toBe(false);
    expect(hasUsableAccountSettingsEncryptionMaterial({
      token: 'inconsistent-data-key',
      encryption: { type: 'dataKey', machineKey, publicKey: new Uint8Array(32).fill(9) },
    })).toBe(false);
  });
});
