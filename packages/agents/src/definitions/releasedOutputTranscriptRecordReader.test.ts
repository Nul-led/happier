import { describe, expect, it } from 'vitest';

import { readReleasedOutputNonTranscriptRecordTypes } from './releasedOutputTranscriptRecordReader.js';

describe('released output transcript record reader', () => {
  it('reads the generated declaration once and keeps unknown record types visible', () => {
    const types = readReleasedOutputNonTranscriptRecordTypes();
    expect(types.has('queue-operation')).toBe(true);
    expect(types.has('command_lifecycle')).toBe(true);
    expect(types.has('some_future_output_type')).toBe(false);
    expect(readReleasedOutputNonTranscriptRecordTypes()).toBe(types);
  });
});
