import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaMeterV1 } from './connectedServiceSchemas.js';
import {
  resolveConnectedServiceQuotaMeterLimitIdentity,
  selectConnectedServiceQuotaMetersForLimitSelection,
} from './connectedServiceQuotaLimitSelection.js';

const meters = [
  { meterId: 'session', providerLimitId: 'standard' },
  { meterId: 'spark:primary', providerLimitId: 'spark' },
  { meterId: 'legacy' },
] as unknown as ConnectedServiceQuotaMeterV1[];

describe('selectConnectedServiceQuotaMetersForLimitSelection', () => {
  it('uses the provider identity when present and the legacy meter identity otherwise', () => {
    expect(resolveConnectedServiceQuotaMeterLimitIdentity(meters[0]!)).toBe('standard');
    expect(resolveConnectedServiceQuotaMeterLimitIdentity(meters[2]!)).toBe('legacy');
  });

  it('retains the original complete meter inventory for the default all policy', () => {
    expect(selectConnectedServiceQuotaMetersForLimitSelection(meters)).toBe(meters);
    expect(selectConnectedServiceQuotaMetersForLimitSelection(meters, {
      mode: 'all',
      providerLimitIds: [],
    })).toBe(meters);
  });

  it('uses provider allowance identity with meter identity as the legacy fallback', () => {
    expect(selectConnectedServiceQuotaMetersForLimitSelection(meters, {
      mode: 'selected',
      providerLimitIds: ['spark', 'legacy'],
    })).toEqual([meters[1], meters[2]]);
  });
});
