import type { SessionStoredContentCryptoContext } from '@/session/transport/encryption/sessionEncryptionContext';

import type { HappierReplayDialogItem } from './types';
import { decryptTranscriptReplayCore } from './decryptTranscriptReplayCore';

type RawTranscriptRow = Readonly<{
  seq?: unknown;
  createdAt?: unknown;
  content?: unknown;
}>;

export function decryptTranscriptReplaySlice(params: Readonly<{
  rows: readonly RawTranscriptRow[];
  crypto: SessionStoredContentCryptoContext;
  maxTextChars?: number;
  maxDialogItems?: number;
}>): Readonly<{
  dialog: HappierReplayDialogItem[];
  dialogReferencedSessionMediaWorkspacePaths: readonly (readonly string[])[];
  latestSynopsisText: string | null;
  referencedSessionMediaWorkspacePaths: readonly string[];
  /** Examined rows the decoder could not read; see `decryptTranscriptReplayCore`. */
  unreadableRowCount: number;
}> {
  return decryptTranscriptReplayCore(params);
}
