/**
 * Where people get Happier. The website's download page (`apps/website/src/data/downloads.ts`) is the
 * public owner of these listings; the app links to the same stores and to that page.
 */
export const HAPPIER_APP_STORE_URL = 'https://apps.apple.com/app/happier-claude-codex-opencode/id6758554297';
export const HAPPIER_GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=dev.happier.app';
/** The desktop download page: it picks the installer for the visitor's platform. */
export const HAPPIER_DESKTOP_DOWNLOAD_URL = 'https://happier.dev/download';
/**
 * Short links to Happier's store listings, for QR codes shown on a computer: a short link makes a sparse
 * code a phone camera reads from across a desk (the long listing URLs would need a dense one).
 */
export const HAPPIER_APP_STORE_SHORT_URL = 'https://happier.dev/appstore';
export const HAPPIER_GOOGLE_PLAY_SHORT_URL = 'https://happier.dev/playstore';
