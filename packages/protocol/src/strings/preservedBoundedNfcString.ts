import { z } from 'zod';

const UTF8_ENCODER = new TextEncoder();

/** Exact-preserving identity string: validates but never trims or normalizes accepted bytes. */
export function preservedBoundedNfcString(maxBytes: number, label: string): z.ZodString {
  return z.string()
    .refine((value) => value === value.normalize('NFC'), `${label} must be NFC-normalized`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .refine((value) => UTF8_ENCODER.encode(value).byteLength <= maxBytes, `${label} exceeds its UTF-8 byte limit`);
}
