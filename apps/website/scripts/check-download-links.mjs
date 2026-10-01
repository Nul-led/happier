#!/usr/bin/env node
/**
 * HEAD every outbound URL the marketing site sends a visitor to, and fail if
 * any of them is not reachable.
 *
 * On 2026-08-08 the deployed site had six dead outbound links at once — all
 * four desktop downloads, the Google Play badge, the LICENSE link, and the
 * changelog link — and nothing in the repo could have caught any of them,
 * because they were string literals inside JSX. This script is the missing
 * check. Run it before every deploy:
 *
 *     node scripts/check-download-links.mjs
 *
 * It is deliberately NOT a vitest: it needs the network, and a unit suite that
 * fails when GitHub has a bad minute is a suite people learn to ignore.
 */

const TARGETS = [
    // Desktop — unversioned rolling aliases; must match src/data/downloads.ts.
    'https://github.com/happier-dev/happier/releases/download/ui-desktop-stable/happier-ui-desktop-darwin-aarch64.dmg',
    'https://github.com/happier-dev/happier/releases/download/ui-desktop-stable/happier-ui-desktop-darwin-x86_64.dmg',
    'https://github.com/happier-dev/happier/releases/download/ui-desktop-stable/happier-ui-desktop-windows-x86_64.exe',
    'https://github.com/happier-dev/happier/releases/download/ui-desktop-stable/happier-ui-desktop-linux-x86_64.AppImage',
    'https://github.com/happier-dev/happier/releases/tag/ui-desktop-stable',

    // Mobile. The Play listing is also the target of the /playstore short link
    // (public/_redirects, printed as a QR code on marketing assets), the App
    // Store URL is /appstore's, and the stable APK is /apk's — a pulled listing
    // or asset must fail this check.
    'https://apps.apple.com/app/happier-claude-codex-opencode/id6758554297',
    'https://github.com/happier-dev/happier/releases/download/ui-mobile-stable/happier-android.apk',
    'https://play.google.com/store/apps/details?id=dev.happier.app',

    // Installer + trust surface
    'https://happier.dev/install',
    'https://happier.dev/install.sh',
    'https://happier.dev/install.ps1',
    'https://happier.dev/happier-release.pub',

    // Product surfaces
    'https://cloud.happier.dev/',
    'https://docs.happier.dev/',
    'https://docs.happier.dev/security',
    'https://docs.happier.dev/providers',
    'https://docs.happier.dev/releases',
    'https://docs.happier.dev/getting-started/onboarding',
    'https://docs.happier.dev/deployment/self-host-runtime',
    'https://guides.happier.dev/',

    // Repo — note the British spelling; /LICENSE is a 404.
    'https://github.com/happier-dev/happier',
    'https://github.com/happier-dev/happier/blob/main/LICENCE',
    'https://github.com/happier-dev/happier/graphs/contributors',

    // Published stats the counters read.
    'https://stats.happier.dev/downloads.json',
    'https://stats.happier.dev/discord.json',

    // Community
    'https://discord.gg/W6Pb8KuHfg',
];

const results = await Promise.all(
    TARGETS.map(async (url) => {
        try {
            let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
            // Some CDNs reject HEAD outright; retry as a ranged GET before failing.
            if (res.status === 405 || res.status === 403) {
                res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
            }
            return { url, status: res.status, ok: res.status < 400 };
        } catch (error) {
            return { url, status: String(error?.message ?? error), ok: false };
        }
    }),
);

let failed = 0;
for (const { url, status, ok } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(status).padEnd(6)} ${url}`);
}

if (failed > 0) {
    console.error(`\n${failed} of ${results.length} links are dead. Do not deploy.`);
    process.exit(1);
}
console.log(`\nAll ${results.length} links reachable.`);
