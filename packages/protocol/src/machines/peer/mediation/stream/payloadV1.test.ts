import { describe, expect, it } from 'vitest';

import { MachineLiveStreamRelayEnvelopeV1Schema } from './v1.js';
import { sealMachineLiveStreamEnvelopeV1, openMachineLiveStreamEnvelopeV1 } from './payloadV1.js';
import { sealSessionDataKeyBundleV0, openSessionDataKeyBundleV0 } from '../../../../crypto/sessionDataKeyBundleWebCrypto.js';
import { encodeBase64, decodeBase64 } from '../../../../crypto/base64.js';

function content(key = new Uint8Array(32).fill(7)) {
  return { mode: 'e2ee' as const, cipher: {
    encryptRaw: async (value: unknown) => encodeBase64(await sealSessionDataKeyBundleV0(value, key)),
    decryptRaw: async (value: string) => {
      const opened = await openSessionDataKeyBundleV0(decodeBase64(value), key);
      return opened.status === 'authenticated' ? opened.value : null;
    },
  } };
}

const frameEnvelope = {
  v: 1, sourceMachineId: 'source', targetMachineId: 'viewer', viewerSocketId: 'tab',
  message: { kind: 'frame', frame: {
    v: 1, streamId: 'stream', sequence: 1, timestampMs: 1000,
    payloadKind: 'image_keyframe', payloadEncoding: 'binary_base64',
    payloadBase64: 'AQID', payloadSizeBytes: 3, codecId: 'image.mjpeg',
  } },
} as const;

describe('live-stream payload wire contract', () => {
  it('seals pixels with the incumbent data-key cipher and opens only the original routing/frame scope', async () => {
    const sealed = await sealMachineLiveStreamEnvelopeV1(frameEnvelope, content());
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) throw new Error(sealed.code);
    expect(sealed.value.message).toMatchObject({ kind: 'frame', frame: { payload: { t: 'encrypted' } } });
    if (sealed.value.message.kind === 'frame') expect(sealed.value.message.frame).not.toHaveProperty('payloadBase64');
    expect(await openMachineLiveStreamEnvelopeV1(sealed.value, content())).toEqual({ ok: true, value: frameEnvelope });
    for (const changed of [
      { ...sealed.value, sourceMachineId: 'substitute' },
      { ...sealed.value, targetMachineId: 'substitute' },
      { ...sealed.value, viewerSocketId: 'substitute' },
      ...(sealed.value.message.kind === 'frame' ? [
        { ...sealed.value, message: { kind: 'frame', frame: { ...sealed.value.message.frame, sequence: 2 } } },
        { ...sealed.value, message: { kind: 'frame', frame: { ...sealed.value.message.frame, streamId: 'another' } } },
        { ...sealed.value, message: { kind: 'frame', frame: { ...sealed.value.message.frame, codecId: 'h264.avcc' } } },
      ] : []),
    ]) expect(await openMachineLiveStreamEnvelopeV1(changed, content())).toEqual({ ok: false, code: 'stream_payload_binding_mismatch' });
    expect(await openMachineLiveStreamEnvelopeV1(sealed.value, content(new Uint8Array(32).fill(8))))
      .toEqual({ ok: false, code: 'stream_payload_authentication_failed' });
    expect(await openMachineLiveStreamEnvelopeV1(sealed.value, { mode: 'e2ee' }))
      .toEqual({ ok: false, code: 'stream_encryption_material_unavailable' });
    expect(await openMachineLiveStreamEnvelopeV1(sealed.value, { mode: 'plain' }))
      .toEqual({ ok: false, code: 'stream_payload_mode_mismatch' });
  });

  it('keeps plain pixels/input explicit and genuinely keyless, rejecting E2EE reinterpretation', async () => {
    for (const envelope of [frameEnvelope, { ...frameEnvelope, message: { kind: 'sideband_control', control: {
      v: 1, streamId: 'stream', sourceId: 'view', eventId: 'input-1', kind: 'keyboard_text', text: 'private input',
    } } }]) {
      const sealed = await sealMachineLiveStreamEnvelopeV1(envelope, { mode: 'plain' });
      if (!sealed.ok) throw new Error(sealed.code);
      expect(await openMachineLiveStreamEnvelopeV1(sealed.value, { mode: 'plain' })).toEqual({ ok: true, value: envelope });
      expect(await openMachineLiveStreamEnvelopeV1(sealed.value, content())).toEqual({ ok: false, code: 'stream_payload_mode_mismatch' });
    }
  });

  it('seals all input fields and authenticates the stream scope before delivery', async () => {
    const envelope = { ...frameEnvelope, message: { kind: 'sideband_control', control: {
      v: 1, streamId: 'stream', sourceId: 'view', eventId: 'input-1', kind: 'keyboard_text', text: 'private input',
    } } };
    const sealed = await sealMachineLiveStreamEnvelopeV1(envelope, content());
    if (!sealed.ok) throw new Error(sealed.code);
    expect(JSON.stringify(sealed.value)).not.toContain('private input');
    expect(JSON.stringify(sealed.value)).not.toContain('keyboard_text');
    expect(await openMachineLiveStreamEnvelopeV1(sealed.value, content())).toEqual({ ok: true, value: envelope });
  });
  it('rejects raw pixels instead of accepting them as an encrypted transport', () => {
    expect(MachineLiveStreamRelayEnvelopeV1Schema.safeParse(frameEnvelope).success).toBe(false);
  });

  it('rejects raw input text at the relay boundary', () => {
    expect(MachineLiveStreamRelayEnvelopeV1Schema.safeParse({
      ...frameEnvelope,
      message: { kind: 'sideband_control', control: {
        v: 1, streamId: 'stream', sourceId: 'view', eventId: 'input-1',
        kind: 'keyboard_text', text: 'private input',
      } },
    }).success).toBe(false);
  });
});
