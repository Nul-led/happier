export type EmbeddedTerminalWriteCompleteEvent = Readonly<{
    terminalId: string;
    seq: number;
    byteOffset: number;
    byteLength: number;
    ackedByteOffset: number;
    writeGeneration: number;
}>;

/** The renderer's visible cursor line, measured relative to its surface (not the stream byte cursor). */
export type EmbeddedTerminalCursorRow = Readonly<{ top: number; height: number }>;

export type EmbeddedTerminalWriteBytesResult =
    | boolean
    | void
    | Readonly<{ status: 'queued' }>;

/** Cached output is parsed for display only; its terminal replies must not reach the process. */
export type EmbeddedTerminalWriteOptions = Readonly<{ intent: 'replay' }>;

export type EmbeddedTerminalRendererHandle = Readonly<{
    write: (data: string, options?: EmbeddedTerminalWriteOptions) => boolean | void;
    writeBytes?: (input: Readonly<{
        terminalId: string;
        seq: number;
        byteOffset: number;
        writeGeneration: number;
        bytes: Uint8Array;
    }>) => EmbeddedTerminalWriteBytesResult;
    clear: () => void;
    focus?: () => void;
    copySelection?: () => void;
    hasSelection?: () => boolean;
    getSelectionText?: () => string;
}>;
