import {
  decodeKeysetCursorV1,
  encodeKeysetCursorV1,
  readKeysetCursorIdV1,
  readKeysetCursorTextV1,
  readKeysetCursorTimeV1,
  type KeysetCursorPartV1,
  type KeysetCursorPartsDecodeV1,
} from '../pagination/keysetCursorV1.js';

/**
 * The one opaque keyset-cursor codec shared by every Team page.
 *
 * A cursor is a *position*, never an authority: visibility, archive, and Team
 * predicates are applied by the query before the cursor narrows it, so a forged
 * position cannot widen a result set. Each page binds its cursor to the exact
 * query that produced it, which is why a cursor decoded against a different
 * Team, filter, or archive scope is rejected rather than silently restarting at
 * page one — that restart would otherwise surface as duplicated rows.
 *
 * The Team directory, the roster, the Group list, and the Group roster all page
 * over a different ordering tuple but need the identical encode/validate/bind
 * behavior. Four hand-written codecs would be four places for that binding rule
 * to drift, so the tuple is the only thing each page owns.
 */

export type TeamKeysetCursorPartV1 = KeysetCursorPartV1;
export type TeamKeysetCursorPartsDecodeV1 = KeysetCursorPartsDecodeV1;

export function encodeTeamKeysetCursorV1(input: Readonly<{
  queryKey: string;
  parts: readonly TeamKeysetCursorPartV1[];
}>): string {
  return encodeKeysetCursorV1(input);
}

export function decodeTeamKeysetCursorV1(value: string, queryKey: string): TeamKeysetCursorPartsDecodeV1 {
  return decodeKeysetCursorV1(value, queryKey);
}

/** A millisecond timestamp component of an ordering tuple. */
export function readTeamKeysetTimeV1(part: TeamKeysetCursorPartV1 | undefined): number | null {
  return readKeysetCursorTimeV1(part);
}

/** An identifier component of an ordering tuple. */
export function readTeamKeysetIdV1(part: TeamKeysetCursorPartV1 | undefined): string | null {
  return readKeysetCursorIdV1(part);
}

/** A normalized-name component; unlike an id it may legitimately be empty. */
export function readTeamKeysetTextV1(part: TeamKeysetCursorPartV1 | undefined): string | null {
  return readKeysetCursorTextV1(part);
}
