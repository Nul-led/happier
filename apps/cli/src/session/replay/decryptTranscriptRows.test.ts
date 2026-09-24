import { describe, expect, it } from 'vitest';

import { encryptSessionPayload, type SessionEncryptionContext } from '@/session/transport/encryption/sessionEncryptionContext';

import { decryptTranscriptRows } from './decryptTranscriptRows';

describe('decryptTranscriptRows', () => {
  it('accepts plaintext transcript rows under an established plain Session (no decrypt)', () => {
    const rows = decryptTranscriptRows({
      crypto: { mode: 'plain', ctx: null },
      rows: [
        {
          seq: 1,
          createdAt: 1000,
          content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'hello' } } },
        },
      ],
    });

    expect(rows).toEqual([
      {
        seq: 1,
        createdAtMs: 1000,
        role: 'user',
        content: { type: 'text', text: 'hello' },
      },
    ]);
  });

  it('refuses a plaintext row under an established e2ee Session', () => {
    const ctx: SessionEncryptionContext = {
      encryptionVariant: 'legacy',
      encryptionKey: new Uint8Array(32).fill(7),
    };

    const rows = decryptTranscriptRows({
      crypto: { mode: 'e2ee', ctx },
      rows: [
        {
          seq: 1,
          createdAt: 1000,
          content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'injected' } } },
        },
      ],
    });

    expect(rows).toEqual([]);
  });

  it('preserves seq and structured meta payloads', () => {
    const ctx: SessionEncryptionContext = {
      encryptionVariant: 'legacy',
      encryptionKey: new Uint8Array(32).fill(7),
    };

    const ciphertext = encryptSessionPayload({
      ctx,
      payload: {
        role: 'agent',
        content: { type: 'text', text: '[memory]' },
        meta: { happier: { kind: 'session_summary_shard.v1', payload: { v: 1, seqFrom: 1, seqTo: 2 } } },
      },
    });

    const rows = decryptTranscriptRows({
      crypto: { mode: 'e2ee', ctx },
      rows: [
        { seq: 12, createdAt: 1000, content: { t: 'encrypted', c: ciphertext } },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.seq).toBe(12);
    expect((rows[0]!.meta as any)?.happier?.kind).toBe('session_summary_shard.v1');
  });

  it('ignores corrupt/undecipherable rows best-effort', () => {
    const ctx: SessionEncryptionContext = {
      encryptionVariant: 'legacy',
      encryptionKey: new Uint8Array(32).fill(7),
    };

    const rows = decryptTranscriptRows({
      crypto: { mode: 'e2ee', ctx },
      rows: [
        { seq: 1, createdAt: 1000, content: { t: 'encrypted', c: 'not-base64' } },
        { seq: 2, createdAt: 1000, content: { t: 'encrypted', c: 'also-bad' } },
      ],
    });

    expect(rows).toEqual([]);
  });
});
