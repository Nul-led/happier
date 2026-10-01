import type { CommandContext } from '@/cli/commandRegistry';
import { handleActionCliRootCommand, renderActionCliRootHelp } from '@/cli/actions/rootCommand';
import { getBrowserChromiumArchiveDownloadInstallableAdapter } from '@/packagedRuntime/installables/sourceAdapters/browserChromium';
import { resolveManagedBrowserSidecarCandidate } from '@/daemon/browser/sidecar/source';
import { installManagedChromiumAppArmorProfile, managedChromiumAppArmorProfile } from '@/daemon/browser/sidecar/sandbox';

/** Explicit local OS prerequisite installation; delegates artifact acquisition to the managed owner. */
export async function handleBrowserCliCommand(context: CommandContext): Promise<void> {
    const args = context.args.slice(1);
    if (args[0] !== 'sandbox') {
        if (!args.length || args.includes('--help') || args.includes('-h')) {
            console.log(`${renderActionCliRootHelp('browser')}\n  happier browser sandbox install [--print]\n    Allow the managed Chromium executable to use its Linux sandbox (sudo).`);
            return;
        }
        return handleActionCliRootCommand('browser', context);
    }
    if (args.includes('--help') || args.includes('-h')) {
        console.log('happier browser sandbox install [--print]\nInstalls an executable-scoped AppArmor userns profile with one sudo action. --print displays the profile without applying it.');
        return;
    }
    if (args[1] !== 'install' || args.slice(2).some(arg => arg !== '--print')) {
        throw new Error('Usage: happier browser sandbox install [--print]');
    }
    if (process.platform !== 'linux') throw new Error('Browser sandbox profile installation applies only to Linux with AppArmor.');
    let candidate = await resolveManagedBrowserSidecarCandidate();
    if (candidate && !candidate.available && !args.includes('--print')) {
        const installed = await getBrowserChromiumArchiveDownloadInstallableAdapter().installOrUpgrade();
        if (!installed.ok) throw new Error(installed.errorMessage);
        candidate = await resolveManagedBrowserSidecarCandidate();
    }
    if (!candidate?.available || !candidate.executablePath) throw new Error('Managed Chromium is not installed. Open an agent browser first, then run this command.');
    if (args.includes('--print')) {
        console.log(managedChromiumAppArmorProfile(candidate.executablePath).content);
        return;
    }
    await installManagedChromiumAppArmorProfile(candidate.executablePath);
    console.log('Managed Chromium sandbox profile installed. Retry the browser action.');
}
