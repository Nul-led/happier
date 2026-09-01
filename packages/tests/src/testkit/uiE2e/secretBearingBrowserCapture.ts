import type { PlaywrightWorkerOptions } from '@playwright/test';

/**
 * Credential-bearing browser journeys must never produce retained images, video, or traces,
 * including on failure. Opaque Playwright trace archives cannot be safely scrubbed afterward.
 */
export const secretBearingBrowserCapturePolicy = {
  trace: 'off',
  screenshot: 'off',
  video: 'off',
} as const satisfies Pick<PlaywrightWorkerOptions, 'trace' | 'screenshot' | 'video'>;
