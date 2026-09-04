import { FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { decodeServerFeaturesResponseBody } from './serverFeaturesParse';

describe('decodeServerFeaturesResponseBody', () => {
  it('cancels an over-budget byte stream before JSON parsing or reading a later chunk', async () => {
    let chunksRead = 0;
    const destroy = vi.fn();
    const source = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        chunksRead += 1;
        yield Buffer.alloc(FEATURES_RESPONSE_MAX_UTF8_BYTES_V1);
        chunksRead += 1;
        yield Buffer.from('x');
        chunksRead += 1;
        yield Buffer.from('{"mustNotBeRead":true}');
      },
      destroy,
    };
    const parse = vi.spyOn(JSON, 'parse');

    await expect(decodeServerFeaturesResponseBody(source)).resolves.toBeNull();

    expect(chunksRead).toBe(2);
    expect(destroy).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
  });
});
