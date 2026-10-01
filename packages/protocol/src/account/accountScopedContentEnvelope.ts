import { z } from 'zod';

import {
  isAccountScopedBlobCiphertextForKind,
  type AccountScopedBlobKind,
} from '../crypto/accountScopedCipherEnvelope.js';

/** The shared explicit Account envelope; each domain retains its value grammar. */
export function buildAccountScopedContentEnvelopeV1Schema<TValue extends z.ZodType>(
  valueSchema: TValue,
  ciphertextSchema: z.ZodType<string> = z.string().min(1),
) {
  return z.discriminatedUnion('t', [
    z.object({ t: z.literal('plain'), v: valueSchema }).strict(),
    z.object({ t: z.literal('encrypted'), c: ciphertextSchema }).strict(),
  ]);
}

/** Shared mode/purpose admission, after the domain's complete envelope parse. */
export function assertAccountScopedContentEnvelopeForModeV1<
  TContent extends { t: 'plain'; v: unknown } | { t: 'encrypted'; c: string },
>(params: Readonly<{
  content: TContent;
  mode: 'plain' | 'e2ee';
  kind: AccountScopedBlobKind;
  mismatchError: () => Error;
}>): TContent {
  const { content, mode, kind } = params;
  if (
    (mode === 'plain' && content.t !== 'plain')
    || (mode === 'e2ee' && (
      content.t !== 'encrypted'
      || !isAccountScopedBlobCiphertextForKind({ kind, ciphertext: content.c })
    ))
  ) {
    throw params.mismatchError();
  }
  return content;
}

/** One envelope/mode contract parameterized by its cipher purpose and value schema. */
export function buildAccountScopedContentEnvelopeV1<TValue extends z.ZodType>(params: Readonly<{
  kind: AccountScopedBlobKind;
  valueSchema: TValue;
  ciphertextSchema?: z.ZodType<string>;
  mismatchError: () => Error;
}>) {
  const schema = buildAccountScopedContentEnvelopeV1Schema(params.valueSchema, params.ciphertextSchema);
  return {
    schema,
    assertForMode(input: unknown, mode: 'plain' | 'e2ee') {
      return assertAccountScopedContentEnvelopeForModeV1({
        content: schema.parse(input), mode, kind: params.kind, mismatchError: params.mismatchError,
      });
    },
  };
}
