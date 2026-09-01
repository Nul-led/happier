export type WorkspaceExportTransferEntry = Readonly<{
    relativePath: string;
    sourcePath: string;
    disposeSource?: () => Promise<void> | void;
}>;
