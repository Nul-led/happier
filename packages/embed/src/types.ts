import type { EmbedCredentialInputV1, EmbedCredentialRequestV1, EmbedErrorCodeV1, EmbedStateV1, EmbedStyleV1, EmbedUiOverridesV1 } from '@happier-dev/protocol/embed';
import type { EmbedColorTokenId } from './themeTokenIds.js';

export type EmbedStyle = Omit<EmbedStyleV1, 'v' | 'colors'> & {
  v?: 1;
  colors?: { light?: Partial<Record<EmbedColorTokenId, string>>; dark?: Partial<Record<EmbedColorTokenId, string>> };
};
export type EmbedCredentialRequest = Omit<EmbedCredentialRequestV1, 'kind'>;
/** Accepts the wire credential or the exact backend-issued result, including tokenId. */
export type EmbedCredential = EmbedCredentialInputV1;
export type EmbedState = Omit<EmbedStateV1, 'kind'>;
export type EmbedError = EmbedErrorCodeV1 | 'frame_unreachable';
export type EmbedSessionCreated = Readonly<{ sessionId: string }>;
export interface EmbedOptions {
  happierUrl: string;
  sessionId?: string | null;
  getCredential(request: EmbedCredentialRequest): Promise<EmbedCredential>;
  title?: string;
  ui?: EmbedUiOverridesV1;
  style?: EmbedStyle;
  onStateChange?(state: EmbedState): void;
  onSessionCreated?(event: EmbedSessionCreated): void;
  onError?(code: EmbedError): void;
}
export type EmbedUpdate = Partial<Pick<EmbedOptions, 'title' | 'ui' | 'style'>>;
export interface EmbedHandle {
  open(sessionId: string | null): void;
  update(options: EmbedUpdate): void;
  destroy(): void;
}
