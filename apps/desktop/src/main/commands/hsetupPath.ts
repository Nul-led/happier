import { constants, copyFileSync, existsSync, mkdirSync, realpathSync, statSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { accessSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { REPO_APPS_ROOT } from '../paths';

export type HsetupPathOptions = Readonly<{
    explicitPath?: string | null;
    resourcesPath?: string | null;
    appPath?: string | null;
    cacheDir: string;
    platform?: NodeJS.Platform;
    arch?: string;
}>;

function platformFilename(platform: NodeJS.Platform): string {
    return platform === 'win32' ? 'hsetup.exe' : 'hsetup';
}

function targetFilename(platform: NodeJS.Platform, arch: string): string | null {
    const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
    if (cpu === null) return null;
    if (platform === 'darwin') return `hsetup-${cpu}-apple-darwin`;
    if (platform === 'linux') return `hsetup-${cpu}-unknown-linux-gnu`;
    if (platform === 'win32') return `hsetup-${cpu}-pc-windows-msvc.exe`;
    return null;
}

function isGzip(bytes: Buffer): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function matchesPlatformExecutable(candidate: string, platform: NodeJS.Platform): boolean {
    let bytes = readFileSync(candidate);
    if (isGzip(bytes)) {
        try {
            bytes = gunzipSync(bytes);
        } catch {
            return false;
        }
    }
    if (platform === 'linux') {
        return bytes.length >= 4
            && bytes[0] === 0x7f
            && bytes[1] === 0x45
            && bytes[2] === 0x4c
            && bytes[3] === 0x46;
    }
    if (platform === 'win32') {
        return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    }
    if (platform === 'darwin' && bytes.length >= 4) {
        const magic = bytes.subarray(0, 4).toString('hex');
        return new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca']).has(magic);
    }
    return false;
}

function canExecute(path: string, platform: NodeJS.Platform): boolean {
    if (platform === 'win32') return true;
    try {
        accessSync(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function materialize(candidate: string, cacheDir: string, platform: NodeJS.Platform): string {
    const source = readFileSync(candidate);
    if (!isGzip(source) && canExecute(candidate, platform)) return realpathSync(candidate);

    const stat = statSync(candidate);
    mkdirSync(cacheDir, { recursive: true });
    const outputPath = join(
        cacheDir,
        `${platformFilename(platform)}-${stat.size}-${Math.floor(stat.mtimeMs)}`,
    );
    if (!existsSync(outputPath)) {
        if (isGzip(source)) {
            writeFileSync(outputPath, gunzipSync(source));
        } else {
            copyFileSync(candidate, outputPath);
        }
        if (platform !== 'win32') chmodSync(outputPath, 0o755);
    }
    return realpathSync(outputPath);
}

export function resolveHsetupPath(options: HsetupPathOptions): string {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const baseName = platformFilename(platform);
    const targetName = targetFilename(platform, arch);
    const explicitPath = options.explicitPath?.trim();
    if (explicitPath) {
        const candidate = resolve(explicitPath);
        if (!existsSync(candidate) || !statSync(candidate).isFile()) {
            throw new Error(`Configured hsetup executor does not exist: ${candidate}`);
        }
        return materialize(candidate, options.cacheDir, platform);
    }

    const roots = [options.resourcesPath, options.appPath].filter((value): value is string => Boolean(value));
    const candidates: string[] = [];
    for (const root of roots) {
        for (const name of [targetName, baseName].filter((value): value is string => value !== null)) {
            candidates.push(join(root, name), join(root, 'binaries', name));
        }
    }
    for (const name of [targetName, baseName].filter((value): value is string => value !== null)) {
        candidates.push(join(REPO_APPS_ROOT, 'ui', 'src-tauri', 'binaries', name));
    }

    for (const candidate of candidates) {
        for (const variant of [candidate, `${candidate}.gz`]) {
            if (!existsSync(variant) || !statSync(variant).isFile()) continue;
            if (!matchesPlatformExecutable(variant, platform)) continue;
            return materialize(variant, options.cacheDir, platform);
        }
    }
    throw new Error(`Unable to resolve bundled ${basename(baseName)} executor. Checked: ${candidates.join(', ')}`);
}
