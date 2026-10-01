import { describe, expect, it } from 'vitest';
import { isDefiniteReplaySeededPreAdmissionRejection } from './spawnPreAdmissionRejection';

describe('pre-admission spawn rejection', () => {
  it.each(['agent_cli_missing', 'agent_signed_out'])('classifies %s as a no-launch rejection', (code) => {
    expect(isDefiniteReplaySeededPreAdmissionRejection(code)).toBe(true);
  });
  it('classifies a missing managed directory as definitive without treating ambiguous outcomes as rejection', () => {
    expect(isDefiniteReplaySeededPreAdmissionRejection('SESSION_DIRECTORY_MISSING')).toBe(true);
    expect(isDefiniteReplaySeededPreAdmissionRejection('SESSION_WEBHOOK_TIMEOUT')).toBe(false);
    expect(isDefiniteReplaySeededPreAdmissionRejection(null)).toBe(false);
  });
});
