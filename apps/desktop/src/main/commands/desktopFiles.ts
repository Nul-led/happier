import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export type ElectronDesktopFilesDependencies = Readonly<{
    pickFile: (options: Readonly<{ title: string; extensions: readonly string[] }>) => Promise<string | null>;
    saveFile: (options: Readonly<{ title: string; defaultName: string; extensions: readonly string[] }>) => Promise<string | null>;
    openPath: (path: string) => Promise<string>;
    revealPath: (path: string) => void;
}>;

export class ElectronDesktopFiles {
    constructor(private readonly dependencies: ElectronDesktopFilesDependencies) {}

    pickPersonalHomeBackupArchive(): Promise<string | null> {
        return this.dependencies.pickFile({
            title: 'Choose a Personal Home backup',
            extensions: ['tar'],
        });
    }

    savePersonalHomeBackupArchive(): Promise<string | null> {
        return this.dependencies.saveFile({
            title: 'Export Personal Home backup',
            defaultName: 'personal-home-backup.tar',
            extensions: ['tar'],
        });
    }

    async openSystemTaskLogPath(path: string): Promise<void> {
        const canonical = this.resolveExistingAbsolutePath(path, 'Log path');
        const allowedRoot = existsSync(join(homedir(), '.happier'))
            ? realpathSync(join(homedir(), '.happier'))
            : join(homedir(), '.happier');
        if (canonical !== allowedRoot && !canonical.startsWith(`${allowedRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
            throw new Error(`Log path is outside the allowed root: ${allowedRoot}`);
        }
        const error = await this.dependencies.openPath(canonical);
        if (error.length > 0) throw new Error(`Failed to open log path: ${error}`);
    }

    revealSystemTaskOutputPath(path: string): void {
        this.dependencies.revealPath(this.resolveExistingAbsolutePath(path, 'System task output path'));
    }

    private resolveExistingAbsolutePath(path: string, label: string): string {
        const trimmed = path.trim();
        if (trimmed.length === 0) throw new Error(`${label} is required.`);
        if (!isAbsolute(trimmed)) throw new Error(`${label} must be an absolute path.`);
        if (!existsSync(trimmed)) throw new Error(`${label} does not exist.`);
        return realpathSync(trimmed);
    }
}
