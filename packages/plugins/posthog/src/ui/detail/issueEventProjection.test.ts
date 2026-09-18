import { describe, expect, it } from 'vitest';

import eventsPage from '../../api/__fixtures__/queryIssueEventsPage.json' with { type: 'json' };
import {
    POSTHOG_ISSUE_EVENTS_MAX_LIMIT,
    parsePosthogIssueEventsEnvelope,
} from '../../api/types/events.js';
import { projectPosthogIssueEvents } from './issueEventProjection.js';

function projectFixture() {
    const envelope = parsePosthogIssueEventsEnvelope(eventsPage);
    if (envelope === null) {
        throw new Error('recorded issue-events fixture must satisfy the strict envelope');
    }
    return projectPosthogIssueEvents(envelope.rawEvents, 0);
}

/** Every string anywhere inside a projected value, for leak detection. */
function collectStrings(value: unknown, into: string[] = []): string[] {
    if (typeof value === 'string') {
        into.push(value);
    } else if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, into);
    } else if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) {
            into.push(key);
            collectStrings(item, into);
        }
    }
    return into;
}

describe('projectPosthogIssueEvents', () => {
    it('keeps only the allowlisted fields the three sampled-data consumers need', () => {
        const projected = projectFixture();

        expect(projected).toHaveLength(3);
        expect(projected[0]).toEqual({
            uuid: '00000000-0000-4000-8000-0000000000f1',
            timestampMs: Date.parse('2026-08-14T06:41:55.902000Z'),
            // Geometry, not content: where the provider put this row in the page the
            // source asked for, which is the address an exact reread reproduces.
            providerOffset: 0,
            sessionId: '00000000-0000-4000-8000-0000000000c1',
            url: 'https://shop.example/checkout/summary',
            exceptions: [
                {
                    type: 'TypeError',
                    value: "Cannot read properties of undefined (reading 'id')",
                    frames: [
                        {
                            function: 'renderSummary',
                            source: 'app/checkout/summary.tsx',
                            line: 128,
                            column: 17,
                            inApp: true,
                        },
                        {
                            function: 'commitWork',
                            source: 'vendor/renderer.js',
                            line: 9042,
                            column: 3,
                            inApp: false,
                        },
                    ],
                },
            ],
        });
    });

    it('drops distinct_id and every unapproved raw property', () => {
        const strings = collectStrings(projectFixture());

        expect(strings.some((value) => value.includes('sentinel-must-not-survive'))).toBe(false);
        expect(strings.some((value) => value.includes('must-not-survive'))).toBe(false);
        expect(strings).not.toContain('distinct_id');
        expect(strings).not.toContain('rawProperties');
        expect(strings).not.toContain('properties');
        expect(strings).not.toContain('$ip');
        expect(strings).not.toContain('$email');
        expect(strings).not.toContain('$set');
        expect(strings).not.toContain('$exception_personURL');
        expect(strings).not.toContain('$geoip_city_name');
        expect(strings).not.toContain('$exception_code_variables');
        expect(strings).not.toContain('203.0.113.7');
        expect(strings).not.toContain('buyer@example.invalid');
    });

    it('never carries code variables into the projected shape', () => {
        const projected = projectFixture();

        expect(JSON.stringify(projected)).not.toContain('code_variables');
        expect(JSON.stringify(projected)).not.toContain('codeVariables');
    });

    it('preserves an event with no frames and an event with no URL or session', () => {
        const projected = projectFixture();

        expect(projected[1]).toEqual({
            uuid: '00000000-0000-4000-8000-0000000000f2',
            timestampMs: Date.parse('2026-08-13T22:10:04.000000Z'),
            providerOffset: 1,
            sessionId: '00000000-0000-4000-8000-0000000000c2',
            url: 'https://shop.example/checkout/summary?coupon=redacted',
            exceptions: [
                {
                    type: 'TypeError',
                    value: "Cannot read properties of undefined (reading 'id')",
                    frames: [],
                },
            ],
        });
        expect(projected[2]).toEqual({
            uuid: '00000000-0000-4000-8000-0000000000f3',
            timestampMs: Date.parse('2026-08-13T05:00:00.000000Z'),
            providerOffset: 2,
            exceptions: [
                {
                    type: 'TypeError',
                    value: "Cannot read properties of undefined (reading 'id')",
                    frames: [],
                },
            ],
        });
    });

    it('drops a property whose type does not match the allowlisted contract', () => {
        const projected = projectPosthogIssueEvents([
            {
                uuid: 'e1',
                pageRowIndex: 0,
                rawProperties: {
                    $session_id: { nested: 'not-a-string' },
                    $current_url: 42,
                    $exception_list: 'not-an-array',
                },
            },
        ], 0);

        expect(projected).toEqual([{ uuid: 'e1', providerOffset: 0, exceptions: [] }]);
    });

    it('addresses each row by the provider position the page began at, not by its own order', () => {
        // The rows a reader holds are the accepted ones; the addresses a reread needs
        // are the provider's. They stop agreeing the moment a sibling is skipped, and
        // the page the reader is looking at may not start at zero.
        const projected = projectPosthogIssueEvents([
            { uuid: 'e-second', pageRowIndex: 1, rawProperties: {} },
            { uuid: 'e-fourth', pageRowIndex: 3, rawProperties: {} },
        ], 20);

        expect(projected.map((event) => event.providerOffset)).toEqual([21, 23]);
    });

    it('does not invent per-event content or count ceilings before envelope fitting', () => {
        const frame = {
            function: `renderSummary${'X'.repeat(400)}`,
            source: `app/checkout/${'deeply/nested/'.repeat(60)}summary.tsx`,
            line: 1,
            column: 2,
            in_app: true,
        };
        const exception = {
            type: `TypeError${'Y'.repeat(400)}`,
            value: 'Cannot read properties of undefined'.repeat(80),
            stacktrace: { frames: Array.from({ length: 400 }, () => frame) },
        };

        const [projected] = projectPosthogIssueEvents([
            {
                uuid: 'e-pathological',
                pageRowIndex: 0,
                rawProperties: {
                    $current_url: `https://shop.example/checkout?${'q=1&'.repeat(600)}`,
                    $session_id: '00000000-0000-4000-8000-0000000000c9',
                    $exception_list: Array.from({ length: 9 }, () => exception),
                },
            },
        ], 0);

        if (projected === undefined) throw new Error('a provider-valid event must stay visible');
        expect('truncated' in projected).toBe(false);
        expect(projected.exceptions).toHaveLength(9);
        expect(projected.exceptions[0]?.frames).toHaveLength(400);
        expect(projected.url).toBe(`https://shop.example/checkout?${'q=1&'.repeat(600)}`);
        expect(projected.exceptions[0]?.value)
            .toBe('Cannot read properties of undefined'.repeat(80));
        expect(projected.exceptions[0]?.frames[0]?.source).toBe(frame.source);
    });

    it('preserves every allowlisted value for the final Action-envelope owner to fit', () => {
        const frame = {
            function: 'X'.repeat(400),
            source: 'Y'.repeat(400),
            line: 1,
            column: 2,
            in_app: false,
        };
        const saturated = Array.from({ length: POSTHOG_ISSUE_EVENTS_MAX_LIMIT }, (_unused, index) => ({
            uuid: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
            timestampMs: 1_760_000_000_000,
            pageRowIndex: index,
            rawProperties: {
                $current_url: 'https://shop.example/'.concat('z'.repeat(2_000)),
                $session_id: '00000000-0000-4000-8000-0000000000c9',
                $exception_list: Array.from({ length: 8 }, () => ({
                    type: 'T'.repeat(400),
                    value: 'V'.repeat(4_000),
                    stacktrace: { frames: Array.from({ length: 400 }, () => frame) },
                })),
            },
        }));

        const projected = projectPosthogIssueEvents(saturated, 0);

        expect(projected).toHaveLength(POSTHOG_ISSUE_EVENTS_MAX_LIMIT);
        expect(collectStrings(projected)).toContain('V'.repeat(4_000));
    });
});

describe('projectPosthogIssueEvents — one owner for the single-line rule', () => {
    it('normalizes a multi-line exception value instead of carrying the newline through', () => {
        // A stack-bearing exception message routinely spans lines, and every other
        // display string in this source already reaches the published single-line
        // shape through `@happier-dev/triage-protocol`. Bounding here without
        // normalizing would make this the one projection with its own rule — and
        // would charge a control character one byte against a bound it costs six
        // to encode, so the saturated-page measurement below would stop being honest.
        const [projected] = projectPosthogIssueEvents([{
            uuid: '00000000-0000-4000-8000-00000000abcd',
            pageRowIndex: 0,
            rawProperties: {
                $exception_list: [{
                    type: 'TypeError',
                    value: 'first line\nsecond line\r\n\tthird',
                    stacktrace: {
                        frames: [{
                            function: 'render\nSummary',
                            source: 'app/summary.tsx',
                            line: 1,
                            column: 2,
                            in_app: true,
                        }],
                    },
                }],
            },
        }], 0);

        expect(projected?.exceptions[0]?.value).toBe('first line second line third');
        expect(projected?.exceptions[0]?.frames[0]?.function).toBe('render Summary');
        // Collapsing a control run is not truncation: the words on both sides survive.
        expect(projected === undefined ? false : 'truncated' in projected).toBe(false);
    });
});
