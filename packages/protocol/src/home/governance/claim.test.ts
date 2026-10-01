import { describe, expect, it } from 'vitest';

import {
  HOME_CLAIM_CODE_LENGTH_V1,
  encodeHomeClaimCodeV1,
  formatHomeClaimCodeV1,
  normalizeHomeClaimCodeV1,
} from './claim.js';

describe('Home claim code format', () => {
  it('encodes 32 bytes as 52 base32 characters that survive printing and pasting', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => (index * 37 + 11) & 0xff);
    const code = encodeHomeClaimCodeV1(bytes);
    expect(code).toHaveLength(HOME_CLAIM_CODE_LENGTH_V1);
    expect(code).toMatch(/^[A-Z2-7]+$/);

    const printed = formatHomeClaimCodeV1(code);
    expect(printed.split('-').every((group) => group.length <= 4)).toBe(true);
    expect(normalizeHomeClaimCodeV1(printed)).toBe(code);
    expect(normalizeHomeClaimCodeV1(` ${printed.toLowerCase().replace(/-/g, ' ')}\n`)).toBe(code);
  });

  it('refuses anything that cannot be a code', () => {
    expect(normalizeHomeClaimCodeV1('')).toBeNull();
    expect(normalizeHomeClaimCodeV1('A'.repeat(51))).toBeNull();
    expect(normalizeHomeClaimCodeV1(`${'A'.repeat(51)}1`)).toBeNull();
    expect(normalizeHomeClaimCodeV1('A'.repeat(53))).toBeNull();
  });
});
