import type { SessionStoredContentCryptoContext } from '@/session/transport/encryption/sessionEncryptionContext';

import type { HappierReplayDialogItem } from './types';
import { decryptTranscriptReplayCore } from './decryptTranscriptReplayCore';

type RawTranscriptRow = Readonly<{
  seq?: unknown;
  createdAt?: unknown;
  content?: unknown;
}>;

export function decryptTranscriptTextItems(params: Readonly<{
  rows: readonly RawTranscriptRow[];
  crypto: SessionStoredContentCryptoContext;
  maxTextChars?: number;
  maxDialogItems?: number;
}>): HappierReplayDialogItem[] {
  return decryptTranscriptReplayCore(params).dialog;
}
