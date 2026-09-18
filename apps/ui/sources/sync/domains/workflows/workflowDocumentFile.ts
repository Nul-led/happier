import { Platform } from 'react-native';

import { nativePickFiles, type NativePickedFile } from '@/utils/files/nativePickFiles';

export type WorkflowDocumentArtifact = Readonly<{ fileName: string; json: string }>;

type WorkflowDocumentSaveRuntime = Readonly<{
  platformOS: string;
  downloadWeb(artifact: WorkflowDocumentArtifact): Promise<void>;
  shareNative(artifact: WorkflowDocumentArtifact): Promise<void>;
}>;

export async function readPickedWorkflowDocument(
  picked: NativePickedFile,
  readNative: (uri: string) => Promise<string>,
): Promise<string> {
  return picked.kind === 'web' ? picked.file.text() : readNative(picked.uri);
}

async function readNativeWorkflowDocument(uri: string): Promise<string> {
  const { File } = await import('expo-file-system');
  return new File(uri).text();
}

export async function pickWorkflowDocumentText(): Promise<string | null> {
  const [picked] = await nativePickFiles({ multiple: false, type: 'application/json' });
  return picked === undefined ? null : readPickedWorkflowDocument(picked, readNativeWorkflowDocument);
}

async function downloadWorkflowDocumentWeb(artifact: WorkflowDocumentArtifact): Promise<void> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Workflow export is unavailable on this platform');
  }
  const url = URL.createObjectURL(new Blob([artifact.json], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.fileName;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body?.appendChild(anchor);
    anchor.click();
    setTimeout(() => anchor.remove(), 0);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function shareWorkflowDocumentNative(artifact: WorkflowDocumentArtifact): Promise<void> {
  const FileSystem = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  const directory = FileSystem.Paths.cache ?? FileSystem.Paths.document;
  if (directory === null || directory === undefined || !await Sharing.isAvailableAsync()) {
    throw new Error('Workflow export is unavailable on this platform');
  }
  const file = new FileSystem.File(directory, artifact.fileName);
  try {
    file.write(artifact.json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
  } finally {
    try { file.delete(); } catch { /* The share target may already own cleanup. */ }
  }
}

export async function saveWorkflowDocumentWithRuntime(
  artifact: WorkflowDocumentArtifact,
  runtime: WorkflowDocumentSaveRuntime,
): Promise<void> {
  if (runtime.platformOS === 'web') await runtime.downloadWeb(artifact);
  else await runtime.shareNative(artifact);
}

export async function saveWorkflowDocument(artifact: WorkflowDocumentArtifact): Promise<void> {
  await saveWorkflowDocumentWithRuntime(artifact, {
    platformOS: Platform.OS,
    downloadWeb: downloadWorkflowDocumentWeb,
    shareNative: shareWorkflowDocumentNative,
  });
}

export function workflowDocumentFileName(name: string): string {
  const stem = name.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'workflow';
  return `${stem}.workflow.json`;
}
