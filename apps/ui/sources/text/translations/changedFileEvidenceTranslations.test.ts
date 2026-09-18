import { describe, expect, it } from 'vitest';

import { auditTranslations, flattenTranslationLeaves } from '../../../tools/i18n/translationAudit';

import { changedFileEvidenceTranslations } from './changedFileEvidenceTranslations';

/**
 * Changed Files evidence is the copy a person reads to decide whether a diff is trustworthy.
 * A locale that renders it in English is not a cosmetic gap: the qualification ("best-effort",
 * "no overlap observed") is the whole point of the disclosure, so it must be readable.
 *
 * Sampled formatters are asserted separately from plain strings because the audit can only
 * compare strings; a formatter that still returns the English sentence is the exact shape the
 * previous placeholder split-brain had.
 */
const FORMATTER_SAMPLES: Readonly<Record<string, readonly [Readonly<Record<string, unknown>>, readonly string[]]>> = {
    howDeterminedForFile: [{ path: 'src/PATH_MARKER.ts' }, ['src/PATH_MARKER.ts']],
    truncatedOldBytes: [{ count: 1234 }, ['1234']],
    truncatedNewBytes: [{ count: 2345 }, ['2345']],
    truncatedDiffBytes: [{ count: 3456 }, ['3456']],
    truncatedAddedLines: [{ count: 4567 }, ['4567']],
    truncatedRemovedLines: [{ count: 5678 }, ['5678']],
};

type ChangedFileEvidenceRoot = (typeof changedFileEvidenceTranslations)['en'];

function callFormatter(
    root: ChangedFileEvidenceRoot,
    key: string,
    args: Readonly<Record<string, unknown>>,
): string | null {
    const leaf = (root.changedFileEvidence as Record<string, unknown>)[key];
    return typeof leaf === 'function' ? (leaf as (input: unknown) => string)(args) : null;
}

describe('changedFileEvidenceTranslations', () => {
    it('keeps the Changed Files evidence vocabulary complete and genuinely localized', () => {
        const { en, ...localesByCode } = changedFileEvidenceTranslations;
        const locales = Object.entries(localesByCode).map(([code, root]) => ({ code, root }));
        const expectedLeaves = flattenTranslationLeaves(en.changedFileEvidence)
            .map((leaf) => `${leaf.key}:${leaf.kind}`)
            .sort();

        const shapeMismatches = locales.flatMap(({ code, root }) => {
            const actualLeaves = flattenTranslationLeaves(root.changedFileEvidence)
                .map((leaf) => `${leaf.key}:${leaf.kind}`)
                .sort();
            return JSON.stringify(actualLeaves) === JSON.stringify(expectedLeaves)
                ? []
                : [`${code}: changedFileEvidence translation shape differs from English`];
        });

        const untranslated = Object.values(auditTranslations({ en, locales }))
            .flatMap((report) => report.untranslatedStrings)
            .filter((entry) => entry.key.startsWith('changedFileEvidence.'))
            .map((entry) => `${entry.locale}: ${entry.key}`);

        expect(shapeMismatches).toEqual([]);
        expect(untranslated).toEqual([]);
    });

    it('localizes every evidence formatter while preserving its interpolated fact', () => {
        const { en, ...localesByCode } = changedFileEvidenceTranslations;
        const locales = Object.entries(localesByCode).map(([code, root]) => ({ code, root }));

        const failures = Object.entries(FORMATTER_SAMPLES).flatMap(([key, [args, markers]]) => {
            const englishSample = callFormatter(en, key, args);
            return locales.flatMap(({ code, root }) => {
                const localeSample = callFormatter(root, key, args);
                if (localeSample === null) return [`${code}: changedFileEvidence.${key} is not a formatter`];
                const droppedMarker = markers.find((marker) => !localeSample.includes(marker));
                if (droppedMarker) {
                    return [`${code}: changedFileEvidence.${key} dropped ${droppedMarker}`];
                }
                return localeSample === englishSample
                    ? [`${code}: changedFileEvidence.${key} falls back to English`]
                    : [];
            });
        });

        expect(failures).toEqual([]);
    });
});
