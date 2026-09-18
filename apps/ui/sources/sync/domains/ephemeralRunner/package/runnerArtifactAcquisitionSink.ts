import { Platform } from 'react-native';

import {
    createWebDownloadFileSink,
    openWebDownloadFileCustody,
    removeWebDownloadFileCustody,
    type WebDownloadFileCustody,
} from '@/hooks/workspaces/transfers/webDownloadFileSink';
import { randomUUID } from '@/platform/randomUUID';
import {
    createNativeCacheFileSink,
    removeNativeCacheFileCustody,
} from '@/sync/runtime/files/nativeCacheFileSink';
import type { LocalUploadSource } from '@/sync/runtime/files/localUploadSourceReader';

/**
 * Acquisition custody is always file-backed: the web sink requires an OPFS
 * `File` and the native sink a cache-file URI. Keeping the in-memory upload
 * variant out of this projection lets reopened custody stay exactly as narrow
 * as the handles this owner can produce.
 */
export type RunnerArtifactAcquisitionLocalSource = Extract<LocalUploadSource, { kind: 'web' | 'native' }>;

export type RunnerArtifactAcquisitionSink = Readonly<{
    writeBytes: (bytes: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    cleanup: () => Promise<void>;
    source: () => Promise<LocalUploadSource>;
    custody: RunnerArtifactAcquisitionCustodyHandle;
}>;

export type RunnerArtifactAcquisitionCustodyHandle =
    | WebDownloadFileCustody
    | Readonly<{ kind: 'native_cache_file'; fileUri: string }>;

export function isRunnerArtifactAcquisitionCustodyHandle(value: unknown): value is RunnerArtifactAcquisitionCustodyHandle {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<RunnerArtifactAcquisitionCustodyHandle>;
    return (candidate.kind === 'web_opfs' && typeof candidate.entryName === 'string')
        || (candidate.kind === 'native_cache_file' && typeof candidate.fileUri === 'string');
}

export async function openRunnerArtifactAcquisitionCustody(
    custody: RunnerArtifactAcquisitionCustodyHandle,
): Promise<RunnerArtifactAcquisitionLocalSource> {
    if (custody.kind === 'web_opfs') {
        return { kind: 'web', file: await openWebDownloadFileCustody(custody) };
    }
    return { kind: 'native', uri: custody.fileUri };
}

export async function removeRunnerArtifactAcquisitionCustody(
    custody: RunnerArtifactAcquisitionCustodyHandle,
): Promise<void> {
    if (custody.kind === 'web_opfs') {
        await removeWebDownloadFileCustody(custody);
        return;
    }
    await removeNativeCacheFileCustody(custody.fileUri);
}

/**
 * Keeps downloaded Runner executables in the existing platform file-custody
 * owners. Browser acquisition requires OPFS rather than buffering the archive.
 */
export async function createRunnerArtifactAcquisitionSink(input: Readonly<{
    artifactName: string;
    sizeBytes: number;
}>): Promise<RunnerArtifactAcquisitionSink> {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
        throw new Error('runner_artifact_size_invalid');
    }
    if (Platform.OS === 'web') {
        const sink = await createWebDownloadFileSink({
            expectedSizeBytes: input.sizeBytes,
            maxBytes: input.sizeBytes,
            requireFileBacked: true,
        });
        return {
            writeBytes: sink.writeBytes,
            close: sink.close,
            cleanup: sink.cleanup,
            source: async () => {
                const file = await sink.getFile();
                if (typeof File === 'undefined' || !(file instanceof File)) {
                    throw new Error('runner_artifact_file_custody_unavailable');
                }
                return { kind: 'web', file };
            },
            custody: sink.fileCustody!,
        };
    }

    const sink = await createNativeCacheFileSink({
        directoryName: `happier-runner-artifact-${randomUUID()}`,
        fileName: input.artifactName,
    });
    if (!sink.ok) {
        throw new Error('runner_artifact_file_custody_unavailable');
    }
    return {
        writeBytes: sink.writeBytes,
        close: sink.close,
        cleanup: sink.cleanup,
        source: async () => ({ kind: 'native', uri: sink.fileUri, sizeBytes: input.sizeBytes }),
        custody: { kind: 'native_cache_file', fileUri: sink.fileUri },
    };
}
