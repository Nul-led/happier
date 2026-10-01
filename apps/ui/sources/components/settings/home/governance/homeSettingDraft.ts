import type { HomeSettingEntryV1 } from '@happier-dev/protocol/home/governance';

import { isHomeSettingWritable, parseHomeSettingText } from './homeSettingDeclaration';

/**
 * Staged edits of registry-declared Home settings (plan §3.14 "Console rendering"): the one draft
 * model the registry-rendered rows share, whether a page commits them with its Save (Features) or
 * one key at a time as each field is left (Server settings).
 */

/** One staged edit: a control's typed value, or a field's raw text. */
export type HomeSettingDraftValue =
    | Readonly<{ kind: 'value'; value: unknown }>
    | Readonly<{ kind: 'text'; text: string }>;

export type HomeSettingDraft = Readonly<Record<string, HomeSettingDraftValue>>;

export type HomeSettingWrite =
    | Readonly<{ ok: true; values: Readonly<Record<string, unknown>>; changed: boolean }>
    | Readonly<{ ok: false; invalidKeys: readonly string[] }>;

/**
 * The one write the staged edits ask for, against the projection they were drawn from. A value back
 * at its registry default clears the Home's stored value rather than pinning the default; an emptied
 * field clears it too; an unchanged, fixed or read-only key is never sent. Field text is parsed by
 * the registry codec, and any text it refuses blocks the whole write.
 */
export function buildHomeSettingWrite(
    entries: readonly HomeSettingEntryV1[],
    draft: HomeSettingDraft,
): HomeSettingWrite {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const values: Record<string, unknown> = {};
    const invalidKeys: string[] = [];
    for (const [key, staged] of Object.entries(draft)) {
        const entry = byKey.get(key);
        if (!isHomeSettingWritable(entry)) continue;
        let next: unknown;
        if (staged.kind === 'text') {
            const parsed = parseHomeSettingText(entry, staged.text);
            if (!parsed.ok) {
                if (parsed.reason === 'required') {
                    if (entry.source === 'home') values[key] = null;
                    continue;
                }
                invalidKeys.push(key);
                continue;
            }
            next = parsed.value;
        } else {
            next = staged.value;
        }
        if (sameValue(next, entry.value)) continue;
        values[key] = entry.source === 'home' && sameValue(entry.declaration?.default, next) ? null : next;
    }
    if (invalidKeys.length > 0) return Object.freeze({ ok: false, invalidKeys });
    return Object.freeze({ ok: true, values, changed: Object.keys(values).length > 0 });
}

/** Values compare structurally: a list setting parses to a fresh array every time. */
function sameValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
    return JSON.stringify(left) === JSON.stringify(right);
}
