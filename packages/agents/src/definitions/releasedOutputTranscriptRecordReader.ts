import { BUNDLED_AGENT_DEFINITIONS_BY_ID } from '../generated/bundledAgentDefinitions.js';

const nonTranscriptRecordTypes: ReadonlySet<string> = new Set(
  Object.values(BUNDLED_AGENT_DEFINITIONS_BY_ID).flatMap((definition) =>
    definition.releasedOutputTranscriptRecordReader?.nonTranscriptRecordTypes ?? [],
  ),
);

/** Released output-row compatibility knowledge, projected from the declaring Agents. */
export function readReleasedOutputNonTranscriptRecordTypes(): ReadonlySet<string> {
  return nonTranscriptRecordTypes;
}
