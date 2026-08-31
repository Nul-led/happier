import type { ComposerReferenceResolutionV1 } from '@happier-dev/plugin-sdk';
import { ProtocolComposerReferenceResolutionV1Schema } from '@happier-dev/plugin-sdk/protocol';

type ComposerReferenceResolutionIdentityV1 = Readonly<{
  id: string;
  label: string;
  description?: string;
}>;

/**
 * Fits a whole-item prefix admitted by the canonical Composer reference-resolution
 * schema, preferring the largest admissible prefix.
 *
 * The caller retains ownership of semantic item ordering and omission text.
 * This helper owns only the shared admission search, so providers neither copy
 * the 16 KiB boundary nor truncate provider-controlled strings.
 */
export function fitComposerReferenceResolutionPrefixV1(input: Readonly<{
  identity: ComposerReferenceResolutionIdentityV1;
  itemCount: number;
  contextForPrefix(includedItemCount: number): string;
}>): ComposerReferenceResolutionV1 | null {
  if (!Number.isSafeInteger(input.itemCount) || input.itemCount < 0) {
    throw new Error('Composer evidence itemCount must be a non-negative safe integer.');
  }
  const admit = (includedItemCount: number) => ProtocolComposerReferenceResolutionV1Schema.safeParse({
    ...input.identity,
    context: input.contextForPrefix(includedItemCount),
  });

  // Admission is not monotonic in the prefix count: adding the last item of one
  // semantic kind can remove that kind's omission disclosure and make the whole
  // context smaller. Walk the caller's already-materialized item cardinality from
  // largest to smallest so the first admitted value is the largest truthful prefix.
  // The two source consumers derive this count from their provider projection; no
  // second count or byte limit belongs here.
  for (let includedItemCount = input.itemCount; includedItemCount >= 0; includedItemCount -= 1) {
    const fitted = admit(includedItemCount);
    if (fitted.success) return fitted.data;
  }
  return null;
}
