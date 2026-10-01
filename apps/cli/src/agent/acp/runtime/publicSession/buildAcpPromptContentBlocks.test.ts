import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

import { buildAcpPromptContentBlocks } from './buildAcpPromptContentBlocks';

it('projects scoped browser media into image blocks and rejects non-vision and missing media', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'happier-browser-acp-'));
  try {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
    const mediaPath = '.happier/uploads/artifacts/session-1/capture/screen.png';
    await mkdir(dirname(join(cwd, mediaPath)), { recursive: true });
    await writeFile(join(cwd, mediaPath), bytes);
    const structuredInput = { v: 1, imageInputs: [{
      id: 'browser-media', kind: 'localImage', path: mediaPath, mimeType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength,
      provenance: { kind: 'browserSessionMedia', sessionId: 'session-1', storage: 'session' },
    }] };
    const params = { cwd, sessionId: 'session-1', text: 'Inspect the page', structuredInput, acceptsImageInput: true };
    expect(await buildAcpPromptContentBlocks(params)).toEqual([
      { type: 'text', text: params.text }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
    ]);
    // The upload owner bounds file bytes; ACP must not invent a competing image-count ceiling.
    expect(await buildAcpPromptContentBlocks({ ...params, structuredInput: { v: 1,
      imageInputs: Array.from({ length: 17 }, (_, index) => ({ ...structuredInput.imageInputs[0], id: `image-${index}` })),
    } })).toHaveLength(18);
    await expect(buildAcpPromptContentBlocks({ ...params, acceptsImageInput: false })).rejects.toMatchObject({ code: 'acp_image_input_unsupported' });
    await rm(join(cwd, mediaPath));
    await expect(buildAcpPromptContentBlocks(params)).rejects.toMatchObject({ code: 'acp_image_input_untrusted' });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
