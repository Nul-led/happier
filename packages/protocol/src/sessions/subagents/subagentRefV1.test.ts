import { describe, expect, it } from 'vitest';

import { VendorSessionRefV1Schema } from './subagentRefV1.js';

describe('VendorSessionRefV1Schema', () => {
  it('preserves the Agent-minted session identity and rejects an absent identity', () => {
    const agentSessionId = '  provider\nses/AB+cd==  ';
    expect(VendorSessionRefV1Schema.parse({ agentSessionId }).agentSessionId)
      .toBe(agentSessionId);
    expect(VendorSessionRefV1Schema.safeParse({
      agentSessionId: ' \n\t ',
    }).success).toBe(false);
  });
});
