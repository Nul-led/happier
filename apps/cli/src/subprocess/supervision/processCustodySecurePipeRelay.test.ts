import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createProcessCustodySecurePipeRelayPreamble } from './processCustodySecurePipeRelay';

describe('process-custody secure named-pipe relay contract', () => {
    it('authenticates the exact peer PID witness with the inherited launch secret', () => {
        const secret = Buffer.alloc(32, 0x31);
        const nonce = Buffer.alloc(16, 0x42);
        const preamble = createProcessCustodySecurePipeRelayPreamble(secret, 4242, nonce);

        expect(preamble.subarray(0, 8).toString('ascii')).toBe('HWSPIPE1');
        expect(preamble.readUInt32BE(8)).toBe(4242);
        expect(preamble.subarray(12, 28)).toEqual(nonce);
        expect(preamble.subarray(28)).toEqual(
            createHmac('sha256', secret).update(preamble.subarray(0, 28)).digest(),
        );
    });

    it('refuses malformed secrets, nonces, and PIDs before producing a witness', () => {
        expect(() => createProcessCustodySecurePipeRelayPreamble(Buffer.alloc(31), 1)).toThrow(TypeError);
        expect(() => createProcessCustodySecurePipeRelayPreamble(Buffer.alloc(32), 0)).toThrow(TypeError);
        expect(() => createProcessCustodySecurePipeRelayPreamble(Buffer.alloc(32), 1, Buffer.alloc(15))).toThrow(TypeError);
    });
});
