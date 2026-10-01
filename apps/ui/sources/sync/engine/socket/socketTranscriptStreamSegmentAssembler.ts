import { createTranscriptStreamSegmentAssembler } from '@happier-dev/session-core/live';
import { registerSessionTranscriptDerivedCacheClear } from '@/sync/runtime/sessionTranscriptDerivedCaches';

/** The app socket consumer owns one delta assembler for its retained transcripts. */
export const socketTranscriptStreamSegmentAssembler = createTranscriptStreamSegmentAssembler();
registerSessionTranscriptDerivedCacheClear(socketTranscriptStreamSegmentAssembler.releaseTranscriptStreamSegmentAssemblyForSession);
