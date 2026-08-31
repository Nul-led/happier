import { describe, expect, it } from 'vitest';

import { secretBearingBrowserCapturePolicy } from './secretBearingBrowserCapture';

describe('secretBearingBrowserCapturePolicy', () => {
  it('disables every Playwright capture channel so secrets cannot leak into uploaded artifacts', () => {
    expect(secretBearingBrowserCapturePolicy).toEqual({
      trace: 'off',
      screenshot: 'off',
      video: 'off',
    });
  });
});
