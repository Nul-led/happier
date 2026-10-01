import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const BROWSER_SANDBOX_NEXT_ACTION = 'Run happier browser sandbox install on this machine to allow user namespaces for the managed Chromium executable.';

/** Only diagnose failed launches; an executable-scoped profile may allow Chrome while unshare stays denied. */
export async function isAppArmorUserNamespaceRestriction(): Promise<boolean> {
    if (process.platform !== 'linux') return false;
    try {
        if ((await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim() !== '1') return false;
    } catch { return false; }
    return new Promise(resolve => {
        execFile('unshare', ['-Ur', 'true'], error => resolve(error !== null && error.code !== 'ENOENT'));
    });
}

export function managedChromiumAppArmorProfile(executablePath: string): Readonly<{ name: string; content: string }> {
    // AppArmor treats glob/brace characters as policy, even inside quotes. Admit literal paths only.
    if (!isAbsolute(executablePath) || /[\x00-\x1f\x7f"\\*?{}\[\]]/u.test(executablePath)) {
        throw new Error('Managed Chromium executable path cannot be represented as a literal AppArmor attachment.');
    }
    const name = `happier-managed-chromium-${createHash('sha256').update(executablePath).digest('hex')}`;
    // Ubuntu's documented per-program userns exception; Chromium retains its own namespace/seccomp sandbox.
    return { name, content: `abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} "${executablePath}" flags=(unconfined) {\n  userns,\n}\n` };
}

export async function installManagedChromiumAppArmorProfile(executablePath: string): Promise<void> {
    if (process.platform !== 'linux') throw new Error('Browser sandbox installation is only needed on Linux with AppArmor.');
    const profile = managedChromiumAppArmorProfile(await realpath(executablePath));
    const scratch = await mkdtemp(join(tmpdir(), 'happier-browser-sandbox-'));
    try {
        const source = join(scratch, profile.name);
        await writeFile(source, profile.content, { mode: 0o600 });
        // One explicit sudo action. Only this profile is loaded; no service restart or sysctl write.
        await new Promise<void>((resolve, reject) => {
            const child = spawn('sudo', ['--', '/bin/sh', '-c',
                'install -m 0644 -- "$1" "$2" && /usr/sbin/apparmor_parser -r -- "$2"',
                'happier-browser-sandbox', source, `/etc/apparmor.d/${profile.name}`], { stdio: 'inherit' });
            child.once('error', reject);
            child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Browser sandbox profile installation failed (${code ?? signal}).`)));
        });
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}
