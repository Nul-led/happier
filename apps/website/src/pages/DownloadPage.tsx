import { DownloadHub } from '../components/DownloadHub';
import { InstallCommand } from '../components/InstallCommand';
import { P, PageHeader, PageShell, Prose } from '../components/PageShell';
import { VerifyInstaller } from '../components/VerifyInstaller';
import { Island } from '../islands';

/**
 * /download
 *
 * The page behind the short links printed on physical and marketing surfaces —
 * the DMG's QR code goes to /appstore and /playstore (public/_redirects), and
 * "where do I get it?" in a reply gets this one URL instead of a per-platform
 * guess. The page's job is one click long, so the copy's job is to make it the
 * RIGHT click: DownloadHub redirects when detection is certain and only
 * highlights when it is not (see its docblock for the per-platform reasoning).
 *
 * ENGLISH-ONLY, DELIBERATELY. The route narrows `locales` to ['en'] in
 * src/routes.tsx, which is the escape hatch Route.locales documents: a
 * mostly-English page under /zh/ is a worse signal than no /zh/ page at all,
 * and this page is mostly platform names, store names and one install command.
 * Its strings are therefore authored here rather than in src/data/pageProse.ts
 * — the catalogue is for copy the overlay translates, and none of this is.
 * The day it grows locales, the strings move there and the route lists them.
 */
export function DownloadPage() {
    return (
        <PageShell>
            <PageHeader
                eyebrow="Download"
                title="Download Happier"
                standfirst={
                    'The desktop app is the full Happier client for macOS, Windows and Linux: ' +
                    'your sessions on every machine, the permission inbox, and the agents ' +
                    'themselves.'
                }
            />

            <Prose data-section="download-hub">
                <Island name="download-hub" component={DownloadHub} />
            </Prose>

            <Prose heading="The apps are half of it. The CLI is the other half." data-section="download-cli">
                <P>
                    The apps drive coding agents running under the Happier CLI on a computer
                    you own. Install it on the machine that holds your code, and the phone,
                    browser and desktop apps all drive the same sessions.
                </P>
                {/* locationOf resolves the surrounding data-section, so the copy
                    event lands as location: 'download-cli' with no override. */}
                <Island name="install-command" component={InstallCommand} />
                <P>
                    The command adapts to your platform: PowerShell on Windows, curl-to-bash
                    everywhere else. Neither needs root, and both verify what they fetch
                    (checksums and minisign signatures) before running any of it.
                </P>
                <VerifyInstaller />
            </Prose>
        </PageShell>
    );
}
