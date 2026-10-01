import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDownloadManifest } from './generateDownloadsPage.mjs';

test('derives desktop download rows from the rolling-alias platform manifest', () => {
  const parsed = parseDownloadManifest(`
const DESKTOP_ASSET_BASE =
  'https://downloads.example.test/ui-desktop-stable';

export const DESKTOP_PLATFORMS = [
  {
    id: 'mac-arm64',
    label: 'macOS',
    sublabel: 'Apple Silicon',
    href: desktopAsset('happier-ui-desktop-darwin-aarch64.dmg'),
  },
  {
    id: 'linux-x86_64',
    label: 'Linux',
    sublabel: 'x64 · AppImage',
    href: desktopAsset('happier-ui-desktop-linux-x86_64.AppImage'),
  },
];

export const DESKTOP_RELEASES_PAGE = 'https://downloads.example.test/releases';
export const APP_STORE_URL = 'https://apps.example.test/happier';
export const ANDROID_APK_URL = 'https://downloads.example.test/happier.apk';
export const ANDROID_PLAY_URL = 'https://play.example.test/happier';
export const ANDROID_PLAY_TESTING_OPT_IN_URL = 'https://play.example.test/testing';
export const WEB_APP_URL = 'https://cloud.example.test/';
export const INSTALL_COMMAND_UNIX = 'install-unix';
export const INSTALL_COMMAND_WINDOWS = 'install-windows';
`);

  assert.deepEqual(parsed.desktop, [
    {
      label: 'macOS (Apple Silicon)',
      href: 'https://downloads.example.test/ui-desktop-stable/happier-ui-desktop-darwin-aarch64.dmg',
    },
    {
      label: 'Linux (x64 · AppImage)',
      href: 'https://downloads.example.test/ui-desktop-stable/happier-ui-desktop-linux-x86_64.AppImage',
    },
  ]);
  assert.equal(Object.hasOwn(parsed, 'desktopVersion'), false);
  assert.equal(parsed.androidPlay, 'https://play.example.test/happier');
});
