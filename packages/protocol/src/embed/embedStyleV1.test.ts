import { describe, expect, it } from 'vitest';

import { EmbedStyleV1Schema } from './embedStyleV1.js';

describe('EmbedStyleV1', () => {
  it('admits unresolved presentation token ids and any preset while keeping structural objects closed', () => {
    const style = { v: 1, preset: 'host-defined-preset', colors: { light: { 'future.token': '#123456' } }, parts: { composer: { radius: 'modalCard' } } };
    expect(EmbedStyleV1Schema.parse(style)).toEqual(style);
    for (const invalid of [
      { ...style, css: 'body{}' },
      { ...style, colors: { light: {}, unexpected: {} } },
      { ...style, typography: { css: 'font-face{}' } },
      { ...style, parts: { composer: { radius: 'modalCard', css: '' } } },
      { ...style, parts: { unknownPart: {} } },
      { ...style, colors: { dark: { 'text.primary': 3 } } },
    ]) expect(EmbedStyleV1Schema.safeParse(invalid).success).toBe(false);
  });
});
