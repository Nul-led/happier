import { Platform } from 'react-native';

/**
 * The one place usage exports become a file.
 *
 * CSV escaping, the timestamped file name, the native cache write and the
 * web download are the same mechanics for every usage surface, so the personal
 * analytics export and the Team resource export share them instead of each
 * growing its own. Nothing here knows what a usage row means: callers hand it
 * finished text and a name.
 */

export function formatUsageExportFileTimestamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

/** RFC 4180 quoting, applied only to the fields that actually need it. */
export function escapeUsageCsvField(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A CSV document from already-stringified cells. Values are written raw rather
 * than locale-formatted so an export stays machine-parseable.
 */
export function buildUsageCsvDocument(rows: readonly (readonly string[])[]): string {
    return `${rows.map((row) => row.map(escapeUsageCsvField).join(',')).join('\n')}\n`;
}

type ExpoFileSystemDirectory = Readonly<{
    uri: string;
}>;

export type UsageExportCacheFile = Readonly<{
    uri: string;
    write: (content: string) => void;
    delete: () => void;
}>;

type ExpoFileSystemModule = Readonly<{
    File: new (parent: ExpoFileSystemDirectory | string, name: string) => UsageExportCacheFile;
    Paths?: Readonly<{
        cache?: ExpoFileSystemDirectory | string | null;
        document?: ExpoFileSystemDirectory | string | null;
    }>;
}>;

type ExpoSharingModule = Readonly<{
    isAvailableAsync?: () => Promise<boolean>;
    shareAsync?: (uri: string) => Promise<void>;
}>;

export async function writeUsageExportCacheFile(input: Readonly<{
    content: string;
    fileName: string;
}>): Promise<UsageExportCacheFile | null> {
    const FileSystem = await import('expo-file-system') as ExpoFileSystemModule;
    const baseDirectory = FileSystem.Paths?.cache ?? FileSystem.Paths?.document ?? null;
    if (!baseDirectory) {
        return null;
    }

    const file = new FileSystem.File(baseDirectory, input.fileName);
    file.write(input.content);
    return file;
}

export function deleteUsageExportFileBestEffort(file: UsageExportCacheFile): void {
    try {
        file.delete();
    } catch {
        // best effort
    }
}

/** Shares a written cache file, reporting whether the platform actually took it. */
export async function shareUsageExportCacheFile(input: Readonly<{
    content: string;
    fileName: string;
}>): Promise<boolean> {
    try {
        const Sharing = await import('expo-sharing') as ExpoSharingModule;
        const file = await writeUsageExportCacheFile(input);
        if (!file) {
            return false;
        }
        try {
            if (typeof Sharing.isAvailableAsync === 'function' && typeof Sharing.shareAsync === 'function') {
                const available = await Sharing.isAvailableAsync();
                if (available) {
                    await Sharing.shareAsync(file.uri);
                    return true;
                }
            }
        } finally {
            deleteUsageExportFileBestEffort(file);
        }
        return false;
    } catch {
        return false;
    }
}

function downloadTextOnWeb(content: string, fileName: string, mimeType: string): boolean {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.rel = 'noopener noreferrer';
        try {
            anchor.style.display = 'none';
        } catch {
            // ignore
        }
        try {
            document.body?.appendChild(anchor);
        } catch {
            // ignore
        }
        anchor.click();
        setTimeout(() => {
            try {
                anchor.remove();
            } catch {
                // ignore
            }
        }, 0);
    } finally {
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }, 1000);
    }
    return true;
}

/** Downloads on web, shares from the native cache elsewhere. */
export async function exportUsageTextDocument(input: Readonly<{
    content: string;
    fileName: string;
    mimeType: string;
}>): Promise<boolean> {
    if (Platform.OS === 'web') {
        return downloadTextOnWeb(input.content, input.fileName, input.mimeType);
    }
    return await shareUsageExportCacheFile({ content: input.content, fileName: input.fileName });
}

export async function exportUsageCsvDocument(input: Readonly<{
    csv: string;
    fileName: string;
}>): Promise<boolean> {
    return await exportUsageTextDocument({
        content: input.csv,
        fileName: input.fileName,
        mimeType: 'text/csv',
    });
}
