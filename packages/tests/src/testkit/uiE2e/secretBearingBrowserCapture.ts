import type { PlaywrightWorkerOptions } from '@playwright/test';

/**
 * Pairing and enrollment pages display credential-bearing QR payloads. Their browser context must
 * never produce retained images, video, or traces, including on failure.
 */
export const secretBearingBrowserCapturePolicy = {
  trace: 'off',
  screenshot: 'off',
  video: 'off',
} as const satisfies Pick<PlaywrightWorkerOptions, 'trace' | 'screenshot' | 'video'>;
