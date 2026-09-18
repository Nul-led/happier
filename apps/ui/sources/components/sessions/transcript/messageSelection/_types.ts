export type TranscriptSelectableMessageRole = 'user' | 'assistant';

export type TranscriptSelectableMessageText = Readonly<{
    role: TranscriptSelectableMessageRole;
    /** Resolved display label for authored rows outside the Agent transcript. */
    label?: string;
    text: string;
}>;

export type TranscriptBulkCopyFormat = 'markdown_labeled' | 'plain';
