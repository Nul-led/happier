import { describe, expect, it } from 'vitest';

import {
  resolveTriageDetailPaneMinimumWidthV1,
  resolveTriageListPaneMinimumWidthV1,
  type TriageScaledTypeMetricsV1,
} from './layout.js';

const TYPE_AT_100_PERCENT: TriageScaledTypeMetricsV1 = {
  title: { fontSize: 15, lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 17 },
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 11, lineHeight: 14 },
};

const TYPE_AT_200_PERCENT: TriageScaledTypeMetricsV1 = {
  title: { fontSize: 30, lineHeight: 40 },
  body: { fontSize: 26, lineHeight: 34 },
  caption: { fontSize: 24, lineHeight: 32 },
  label: { fontSize: 22, lineHeight: 28 },
};

const SPACING = { xsmall: 4, small: 8, medium: 12 } as const;

function paneMinima(type: TriageScaledTypeMetricsV1) {
  return {
    list: resolveTriageListPaneMinimumWidthV1({ type, spacing: SPACING }),
    detail: resolveTriageDetailPaneMinimumWidthV1({ type, spacing: SPACING }),
  };
}

describe('Triage readable pane measures', () => {
  it('derives both pane minima from the reading measure, so they grow with accessibility text', () => {
    const small = paneMinima(TYPE_AT_100_PERCENT);
    const large = paneMinima(TYPE_AT_200_PERCENT);

    expect(large.list).toBeGreaterThan(small.list);
    expect(large.detail).toBeGreaterThan(small.detail);
    // Source-native detail carries prose; it needs the wider comfortable measure.
    expect(small.detail).toBeGreaterThan(small.list);
  });
});
