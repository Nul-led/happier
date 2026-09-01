import {
  projectTranscriptBodySemanticContent,
  type TranscriptBodySemanticProjection,
} from '@happier-dev/protocol';

export type DecodedTranscriptBody = TranscriptBodySemanticProjection;

/** CLI compatibility name for the protocol-owned semantic transcript projection. */
export const decodeTranscriptBody = projectTranscriptBodySemanticContent;
